# Myo Armband — GitHub repos as reference sources

Search date: 2026-11-04 (GitHub API, ~400 repos reviewed; noise such as "myOS" or "MyOkHttp" filtered out).
Format: ⭐ stars · language · last push. ARCH = archived.

## Top picks to start with (by direct usefulness)
1. **thalmiclabs/myo-bluetooth** — ⭐145 · C · ARCH — `myohw.h`, the official BLE specification. Source of truth for the protocol. https://github.com/thalmiclabs/myo-bluetooth
2. **PerlinWarp/pyomyo** — ⭐192 · Python · 2026-07 — SDK-free, multithreaded Python library supporting all 3 EMG modes (filtered/raw/preprocessed). Its wiki covers armband placement and EMG basics. Useful for the filtered-vs-raw EMG comparison. https://github.com/PerlinWarp/pyomyo
3. **iomz/dl-myo** — ⭐16 · Python · 2026-10 — dongle-less MyoConnect alternative (generic BLE); service/characteristic names aligned with myohw.h (`myo/profile.py`). Active and tested; a good reference for GATT and command mapping. https://github.com/iomz/dl-myo
4. **dzhu/myo-raw** — ⭐227 · Python · 2017 — the origin of almost every "SDK-free" library. https://github.com/dzhu/myo-raw
5. **LibEMG/libemg** — ⭐81 · Python · 2026-10 — EMG gesture recognition library (features, classifiers, post-processing, online pipeline) with Myo support. https://github.com/LibEMG/libemg
6. **UlysseCoteAllard/MyoArmbandDataset** — ⭐98 · 2022 — Côté-Allard dataset recorded with the Myo (pre-training / transfer learning). https://github.com/UlysseCoteAllard/MyoArmbandDataset
7. **balandinodidonato/MyoToolkit** — ⭐117 · 2016 — curated list of third-party Myo code (historical index). https://github.com/balandinodidonato/MyoToolkit

## 1. BLE protocol and connection libraries (no official SDK)
| Repo | ⭐ | Language | Push | Why look at it |
|---|---|---|---|---|
| [Crimson-Crow/pymyo](https://github.com/Crimson-Crow/pymyo) | 8 | Python | 2024-11 | Pythonic cross-platform API to configure and read the Myo over BLE; a good model for a full configuration API |
| [Alvipe/Open-Myo](https://github.com/Alvipe/Open-Myo) | 25 | Python | 2023-01 | Module over a generic BLE interface; its fixes were merged into pyomyo |
| [mamo91/Dongleless-myo](https://github.com/mamo91/Dongleless-myo) | 19 | Python | 2020-11 | MyoConnect replacement on Linux without the dongle |
| [jshahbazi/FreeMyo.py](https://github.com/jshahbazi/FreeMyo.py) | 8 | Python | 2022-11 | BLE interface for macOS |
| [charliegerard/myo-web-bluetooth.js](https://github.com/charliegerard/myo-web-bluetooth.js) | 47 | JS | 2017-05 | Connection via Web Bluetooth; compact and readable |
| [ManuelOverdijk/myonodebluetooth](https://github.com/ManuelOverdijk/myonodebluetooth) | 19 | JS | 2016-12 | Node.js + noble |
| [cortinico/myonnaise](https://github.com/cortinico/myonnaise) | 31 | Kotlin | 2026-10 | Android library (RxJava) for raw EMG + sample app; maintained |
| [d4rken/myolib](https://github.com/d4rken/myolib) | 44 | Java | ARCH | Android, full data access and multiple Myos at once |
| [meleap/myo_AndoridEMG](https://github.com/meleap/myo_AndoridEMG) | 26 | Java | 2015 | EMG on Android by "hacking" the BLE (historical) |
| [brokenpylons/MyoLinux](https://github.com/brokenpylons/MyoLinux) | 29 | C++ | 2017 | C++ library for Linux |
| [Ramir0/Myo4Linux](https://github.com/Ramir0/Myo4Linux) | 52 | Python | 2017 | Linux via the Bluegiga BGAPI dongle |
| [sebastiankmiec/PythonMyoLinux](https://github.com/sebastiankmiec/PythonMyoLinux) | 38 | Python | 2019 | EMG/IMU capture + real-time predictions |
| [vroland/MyoBridge](https://github.com/vroland/MyoBridge) | 83 | C | 2019 | Firmware for HM-11 (CC2541) + Arduino library: direct microcontroller ↔ Myo connection |
| [m-fi/Myo-Arduino](https://github.com/m-fi/Myo-Arduino) | 8 | C++ | 2018 | Arduino Uno + HM-11 |
| [carolambek/myo-raspberry-reading](https://github.com/carolambek/myo-raspberry-reading) | 8 | Python | 2018 | Raw reading from Raspberry Pi 3 / Zero W |

Note: there is no Rust library for the Myo on GitHub ("myo + Rust" searches only return noise).

## 2. Official SDK wrappers (API and concept reference; require Myo Connect)
| Repo | ⭐ | Language | Push |
|---|---|---|---|
| [NiklasRosenstein/myo-python](https://github.com/NiklasRosenstein/myo-python) | 283 | Python | ARCH |
| [tayfuzun/MyoSharp](https://github.com/tayfuzun/MyoSharp) | 64 | C# | 2021 |
| [NicholasAStuart/myo-java](https://github.com/NicholasAStuart/myo-java) | 42 | Java | 2016 |
| [logotype/MyoJS](https://github.com/logotype/MyoJS) | 93 | JS | 2018 |
| [mark-toma/MyoMex](https://github.com/mark-toma/MyoMex) | 35 | MATLAB | 2022 |
| [uetchy/myo-ruby](https://github.com/uetchy/myo-ruby) | 14 | Ruby | 2015 |

## 3. Recording, visualization and data tools
| Repo | ⭐ | Language | Push | Note |
|---|---|---|---|---|
| [NsquaredLab/MyoGestic](https://github.com/NsquaredLab/MyoGestic) | 32 | Python | 2026-11 | Framework for developing and testing myocontrol algorithms (very active) |
| [MKLab-ITI/MyoWebToolkit](https://github.com/MKLab-ITI/MyoWebToolkit) | 20 | JS | 2024-07 | Web tools for research with the Myo |
| [Neural-Space/pewter](https://github.com/Neural-Space/pewter) | 25 | JS | 2021 | Data acquisition and visualization |
| [muhammetduzenli/myo-emg-data-recorder](https://github.com/muhammetduzenli/myo-emg-data-recorder) | 10 | HTML | 2022 | GUI to record EMG + IMU |
| [dcaffo98/myo-emg-dataset](https://github.com/dcaffo98/myo-emg-dataset) | 11 | Python | 2024 | Framework to build your own gesture dataset |
| [smetanadvorak/myo_ecn](https://github.com/smetanadvorak/myo_ecn) | 11 | C++ | 2020 | EMG signal processing toolbox for the Myo |
| [jdaly101/raw-myo-plot](https://github.com/jdaly101/raw-myo-plot) | 7 | Python | 2015 | Simple real-time data GUI |
| [ste92uo/ROS_multipleMyo](https://github.com/ste92uo/ROS_multipleMyo) | 14 | Python | 2018 | Multiple Myos on one machine + ROS |

## 4. EMG gesture classification (models and paper code)
| Repo | ⭐ | Language | Push | Note |
|---|---|---|---|---|
| [Zeng-Jia/awesome-sEMG-hand-gesture-recognition](https://github.com/Zeng-Jia/awesome-sEMG-hand-gesture-recognition) | 46 | — | 2021 | Curated list of sEMG work (bibliographic starting point) |
| [malele4th/sEMG_DeepLearning](https://github.com/malele4th/sEMG_DeepLearning) | 474 | Notebook | 2021 | Deep learning on sEMG |
| [tsagkas/sEMG-HandGestureRecognition](https://github.com/tsagkas/sEMG-HandGestureRecognition) | 135 | Python | 2020 | CNN, MSc thesis (NinaPro) |
| [Laknath1996/sEMG-Hand-Gesture-Recognition](https://github.com/Laknath1996/sEMG-Hand-Gesture-Recognition) | 79 | Python | 2024 | Real-time, using temporal muscle activation maps |
| [DSIP-UPatras/ICASSP2019_TCN](https://github.com/DSIP-UPatras/ICASSP2019_TCN) | 68 | Python | 2019 | Temporal Convolutional Networks |
| [ketyi/2SRNN](https://github.com/ketyi/2SRNN) | 42 | Python | 2020 | Domain adaptation with RNNs (cross-session/cross-user calibration) |
| [Answeror/adamyo](https://github.com/Answeror/adamyo) | 22 | Python | 2017 | Inter-session domain adaptation |
| [jehanyang/emgbench](https://github.com/jehanyang/emgbench) | 24 | Python | 2025-09 | Domain generalization/adaptation benchmark for EMG gestures |
| [neu-spiral/multi-label-emg](https://github.com/neu-spiral/multi-label-emg) | 7 | Python | 2024 | Multi-label classification (gesture combinations) |
| [exelban/myo-armband-nn](https://github.com/exelban/myo-armband-nn) | 44 | Python | ARCH | TF neural network directly on Myo data |
| [rmantena/Myo_gestureArmBand_experiments](https://github.com/rmantena/Myo_gestureArmBand_experiments) | 13 | Python | 2018 | Custom gestures with scikit-learn (classic baseline) |
| [vroland/MyoIMUGestureController](https://github.com/vroland/MyoIMUGestureController) | 31 | C++ | 2015 | Gestures using almost only the IMU |
| [brainflow-dev/brainflow](https://github.com/brainflow-dev/brainflow) | 1785 | C++ | 2026-11 | Biosensor library (EEG/EMG/ECG); architecture reference for acquisition + DSP |
| [fraunhoferportugal/tsfel](https://github.com/fraunhoferportugal/tsfel) | 1112 | Python | 2026-10 | 60+ time-series features (alternative/complement to RMS, MAV, WL, ZC) |

## 5. Datasets recorded with the Myo
| Repo | ⭐ | Note |
|---|---|---|
| [UlysseCoteAllard/MyoArmbandDataset](https://github.com/UlysseCoteAllard/MyoArmbandDataset) | 98 | Côté-Allard, the most cited |
| [tsagkas/MyoUP_dataset](https://github.com/tsagkas/MyoUP_dataset) | 44 | Custom Myo dataset |
| [nccvector/Electro-Myography-EMG-Dataset](https://github.com/nccvector/Electro-Myography-EMG-Dataset) | 22 | ~7000 finger-motion samples, 8 electrodes |
| [aljazfrancic/myo-readings-dataset](https://github.com/aljazfrancic/myo-readings-dataset) | 21 | Various gestures, updated 2026-06 |
| [michidk/myo-dataset](https://github.com/michidk/myo-dataset) | 14 | sEMG from 13 subjects |
| [Agire/BandMyo-Dataset](https://github.com/Agire/BandMyo-Dataset) | 12 | BandMyo |
| [Zeng-Jia/Ninapro-dataset-processing](https://github.com/Zeng-Jia/Ninapro-dataset-processing) | 35 | Processing pipeline + PyTorch dataloader for NinaPro |

## 6. Mapping to system input and control (Myo Connect replacements)
| Repo | ⭐ | Language | Push | Note |
|---|---|---|---|---|
| [PerlinWarp/NeuroGloves](https://github.com/PerlinWarp/NeuroGloves) | 66 | Notebook | 2021 | Myo for VR games in SteamVR |
| [PerlinWarp/Neuro-Breakout](https://github.com/PerlinWarp/Neuro-Breakout) | 20 | Notebook | 2021 | Playing Breakout with EMG (small end-to-end example) |
| [conradev/MyoActivator](https://github.com/conradev/MyoActivator) | 22 | Obj-C | 2014 | Gestures → actions on iOS |
| [damageless/MyoTaskerPlugin](https://github.com/damageless/MyoTaskerPlugin) | 20 | Java | 2014 | Android automation (Tasker) |
| [Cubillosxy/MYO-PYTHON-BEBOP](https://github.com/Cubillosxy/MYO-PYTHON-BEBOP) | 12 | Python | 2026-05 | Bebop drone control |
| [shayanalibhatti/Finger-Movement-Classification-…](https://github.com/shayanalibhatti/Finger-Movement-Classification-via-Machine-Learning-using-EMG-Armband-for-3D-Printed-Robotic-Hand) | 91 | Python | 2020 | Finger classification → 3D-printed robotic hand |
| [CogitoNTNU/Grip](https://github.com/CogitoNTNU/Grip) | 12 | Notebook | 2025 | EMG-controlled robotic hand |

## 7. Outputs to other systems (OSC / MIDI / WebSocket / ROS)
| Repo | ⭐ | Language | Push | Note |
|---|---|---|---|---|
| [samyk/myo-osc](https://github.com/samyk/myo-osc) | 82 | C++ | 2017 | Cross-platform OSC bridge |
| [balandinodidonato/MyoMapper](https://github.com/balandinodidonato/MyoMapper) | 51 | C++ | 2018 | App that maps data to OSC (mapping UI, good UX reference) |
| [francocruces/MioConnect](https://github.com/francocruces/MioConnect) | 31 | Python | 2019 | MyoConnect alternative with OSC |
| [cpmpercussion/myo-to-osc](https://github.com/cpmpercussion/myo-to-osc) | 12 | Python | 2018 | Pure Python, cross-platform |
| [benkuper/MyOSC](https://github.com/benkuper/MyOSC) | 21 | C++ | 2016 | Modular OSC bridge with UI |
| [logotype/myodaemon](https://github.com/logotype/myodaemon) | 28 | — | 2018 | WebSocket daemon |
| [JulesFrancoise/myo-for-max](https://github.com/JulesFrancoise/myo-for-max) | 27 | Max | 2017 | Max external |
| [bcaramiaux/Myo-maxpd](https://github.com/bcaramiaux/Myo-maxpd) | 13 | C++ | 2017 | Max/PureData objects with raw EMG |
| [mattfelsen/ofxMyoWebSockets](https://github.com/mattfelsen/ofxMyoWebSockets) | 14 | C++ | 2016 | openFrameworks addon |
| [uts-magic-lab/ros_myo](https://github.com/uts-magic-lab/ros_myo) | 26 | Python | 2017 | ROS wrapper |

## 8. Security and other curiosities
- [seemoo-lab/myo-keylogging](https://github.com/seemoo-lab/myo-keylogging) — ⭐8 — paper "My(o) Armband Leaks Passwords": keylogging via EMG+IMU. Interesting as a demonstration of how finely the signal can discriminate (individual fingers).
- [ultimaterobotics/uMyo](https://github.com/ultimaterobotics/uMyo) — ⭐50 · C · 2026-03 — open-hardware EMG sensor (not the Thalmic Myo, but a living ecosystem with Python and BLE tools).
