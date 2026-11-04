//! Per-channel signal analysis: time-domain metrics and frequency spectra of the EMG.

use std::collections::VecDeque;
use std::f32::consts::PI;
use std::sync::Arc;

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};

use super::protocol::{EMG_CHANNELS, EMG_RATE_HZ, EmgSample};

/// About 320 ms: long enough to be stable, and short enough to follow a contraction.
const METRICS_WINDOW: usize = 64;
/// About 1.3 s, for a resolution of about 0.8 Hz.
const FFT_SIZE: usize = 256;
pub const SPECTRUM_BINS: usize = FFT_SIZE / 2 + 1;
const ANALYSIS_VERSION: u8 = 1;
/// Ignores sign changes smaller than this, so that ADC noise around zero isn't counted.
const ZERO_CROSSING_DEADBAND: f32 = 2.0;

/// Time-domain metrics of one channel over the metrics window.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct ChannelMetrics {
    pub rms: f32,
    /// Mean absolute value.
    pub mav: f32,
    pub peak: f32,
    /// Sign changes per second.
    pub zero_crossing_rate: f32,
}

pub fn compute_metrics(samples: &[f32]) -> ChannelMetrics {
    if samples.is_empty() {
        return ChannelMetrics::default();
    }
    let count = samples.len() as f32;
    let sum_of_squares: f32 = samples.iter().map(|value| value * value).sum();
    let sum_of_absolutes: f32 = samples.iter().map(|value| value.abs()).sum();
    let peak = samples
        .iter()
        .fold(0.0f32, |peak, value| peak.max(value.abs()));

    let mut crossings = 0;
    let mut last_sign = 0.0f32;
    for value in samples {
        if value.abs() >= ZERO_CROSSING_DEADBAND {
            let sign = value.signum();
            if last_sign != 0.0 && sign != last_sign {
                crossings += 1;
            }
            last_sign = sign;
        }
    }

    ChannelMetrics {
        rms: (sum_of_squares / count).sqrt(),
        mav: sum_of_absolutes / count,
        peak,
        zero_crossing_rate: crossings as f32 * EMG_RATE_HZ as f32 / count,
    }
}

/// Keeps the recent EMG history and analyzes it on demand.
pub struct Analyzer {
    history: Vec<VecDeque<f32>>,
    fft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    window_gain: f32,
    buffer: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
    /// Whether samples have arrived since the last analysis.
    fresh: bool,
}

impl Analyzer {
    pub fn new() -> Self {
        let fft = FftPlanner::new().plan_fft_forward(FFT_SIZE);
        let window: Vec<f32> = (0..FFT_SIZE)
            .map(|index| 0.5 - 0.5 * (2.0 * PI * index as f32 / FFT_SIZE as f32).cos())
            .collect();
        let window_gain = window.iter().sum();
        let scratch = vec![Complex::default(); fft.get_inplace_scratch_len()];
        Self {
            history: vec![VecDeque::with_capacity(FFT_SIZE + 1); EMG_CHANNELS],
            fft,
            window,
            window_gain,
            buffer: vec![Complex::default(); FFT_SIZE],
            scratch,
            fresh: false,
        }
    }

    pub fn push(&mut self, sample: &EmgSample) {
        self.fresh = true;
        for (channel, history) in self.history.iter_mut().enumerate() {
            if history.len() == FFT_SIZE {
                history.pop_front();
            }
            history.push_back(f32::from(sample[channel]));
        }
    }

    /// Whether there is enough new data to analyze. It stays false while the EMG is off,
    /// so that the views don't keep receiving a stale analysis.
    pub fn has_new_data(&self) -> bool {
        self.fresh && self.history[0].len() >= METRICS_WINDOW
    }

    /// Amplitude spectrum in ADC units. It stays at zero until a full window has arrived.
    fn spectrum(&mut self, channel: usize, output: &mut [f32]) {
        if self.history[channel].len() < FFT_SIZE {
            output.fill(0.0);
            return;
        }
        // Removing the mean keeps the DC offset from leaking into the lowest bins.
        let mean = self.history[channel].iter().sum::<f32>() / FFT_SIZE as f32;
        for (index, value) in self.history[channel].iter().enumerate() {
            self.buffer[index] = Complex::new((value - mean) * self.window[index], 0.0);
        }
        self.fft
            .process_with_scratch(&mut self.buffer, &mut self.scratch);
        for (bin, value) in output.iter_mut().enumerate() {
            *value = 2.0 * self.buffer[bin].norm() / self.window_gain;
        }
    }

    /// Analyzes the current history into a binary frame.
    ///
    /// All values are little-endian. Layout:
    /// - Header: version (`u8`), channels (`u8`), spectrum bins (`u16`), sample rate (`f32`).
    /// - `f32` values, per channel: RMS, MAV, peak, zero-crossing rate.
    /// - `f32` amplitude spectrum of each channel in turn.
    pub fn encode_frame(&mut self) -> Vec<u8> {
        self.fresh = false;
        let values = EMG_CHANNELS * (4 + SPECTRUM_BINS);
        let mut frame = Vec::with_capacity(8 + values * 4);
        frame.push(ANALYSIS_VERSION);
        frame.push(EMG_CHANNELS as u8);
        frame.extend_from_slice(&(SPECTRUM_BINS as u16).to_le_bytes());
        frame.extend_from_slice(&(EMG_RATE_HZ as f32).to_le_bytes());

        for history in &self.history {
            let skip = history.len().saturating_sub(METRICS_WINDOW);
            let recent: Vec<f32> = history.iter().skip(skip).copied().collect();
            let metrics = compute_metrics(&recent);
            for value in [
                metrics.rms,
                metrics.mav,
                metrics.peak,
                metrics.zero_crossing_rate,
            ] {
                frame.extend_from_slice(&value.to_le_bytes());
            }
        }

        let mut spectrum = [0.0f32; SPECTRUM_BINS];
        for channel in 0..EMG_CHANNELS {
            self.spectrum(channel, &mut spectrum);
            for value in spectrum {
                frame.extend_from_slice(&value.to_le_bytes());
            }
        }
        frame
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_f32(frame: &[u8], index: usize) -> f32 {
        let start = 8 + index * 4;
        f32::from_le_bytes(frame[start..start + 4].try_into().unwrap())
    }

    #[test]
    fn computes_metrics_of_a_known_signal() {
        let samples = [3.0, -3.0, 3.0, -3.0];
        let metrics = compute_metrics(&samples);
        assert_eq!(metrics.rms, 3.0);
        assert_eq!(metrics.mav, 3.0);
        assert_eq!(metrics.peak, 3.0);
        // 3 sign changes in 4 samples at 200 Hz.
        assert_eq!(metrics.zero_crossing_rate, 150.0);
    }

    #[test]
    fn rms_and_mav_differ_for_uneven_signals() {
        let metrics = compute_metrics(&[0.0, 0.0, 0.0, 4.0]);
        assert_eq!(metrics.rms, 2.0);
        assert_eq!(metrics.mav, 1.0);
        assert_eq!(metrics.peak, 4.0);
    }

    #[test]
    fn ignores_small_oscillations_around_zero() {
        let metrics = compute_metrics(&[1.0, -1.0, 1.0, -1.0, 1.0, -1.0]);
        assert_eq!(metrics.zero_crossing_rate, 0.0);
    }

    #[test]
    fn handles_an_empty_window() {
        assert_eq!(compute_metrics(&[]), ChannelMetrics::default());
    }

    fn sine_analyzer(frequency: f32, amplitude: f32) -> Analyzer {
        let mut analyzer = Analyzer::new();
        for index in 0..FFT_SIZE {
            let phase = 2.0 * PI * frequency * index as f32 / EMG_RATE_HZ as f32;
            let value = (amplitude * phase.sin()).round() as i8;
            analyzer.push(&[value; EMG_CHANNELS]);
        }
        analyzer
    }

    #[test]
    fn finds_the_frequency_and_amplitude_of_a_sine() {
        // Bin 32 of a 256-point FFT at 200 Hz is exactly 25 Hz.
        let frame = sine_analyzer(25.0, 100.0).encode_frame();
        let spectrum_start = EMG_CHANNELS * 4;
        let spectrum: Vec<f32> = (0..SPECTRUM_BINS)
            .map(|bin| read_f32(&frame, spectrum_start + bin))
            .collect();

        let peak_bin = (0..SPECTRUM_BINS)
            .max_by(|a, b| spectrum[*a].total_cmp(&spectrum[*b]))
            .unwrap();
        assert_eq!(peak_bin, 32);
        assert!((spectrum[32] - 100.0).abs() < 2.0, "{}", spectrum[32]);
        assert!(spectrum[64] < 2.0);
    }

    #[test]
    fn removes_the_dc_offset_from_the_spectrum() {
        let mut analyzer = Analyzer::new();
        for _ in 0..FFT_SIZE {
            analyzer.push(&[50; EMG_CHANNELS]);
        }
        let frame = analyzer.encode_frame();
        assert!(read_f32(&frame, EMG_CHANNELS * 4).abs() < 1e-3);
    }

    #[test]
    fn encodes_the_header_and_expected_size() {
        let mut analyzer = Analyzer::new();
        assert!(!analyzer.has_new_data());
        for _ in 0..METRICS_WINDOW {
            analyzer.push(&[5; EMG_CHANNELS]);
        }
        assert!(analyzer.has_new_data());

        let frame = analyzer.encode_frame();
        assert!(!analyzer.has_new_data());
        assert_eq!(frame[0], 1);
        assert_eq!(frame[1], 8);
        assert_eq!(u16::from_le_bytes([frame[2], frame[3]]), 129);
        assert_eq!(&frame[4..8], 200.0f32.to_le_bytes());
        assert_eq!(frame.len(), 8 + 8 * (4 + 129) * 4);
        // The first channel's RMS, and the spectrum still empty before a full window.
        assert_eq!(read_f32(&frame, 0), 5.0);
        assert_eq!(read_f32(&frame, EMG_CHANNELS * 4 + 10), 0.0);
    }

    #[test]
    fn limits_the_history_to_one_fft_window() {
        let mut analyzer = Analyzer::new();
        for _ in 0..FFT_SIZE * 3 {
            analyzer.push(&[1; EMG_CHANNELS]);
        }
        assert_eq!(analyzer.history[0].len(), FFT_SIZE);
    }
}
