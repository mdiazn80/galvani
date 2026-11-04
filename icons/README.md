# Galvani — iconos base (concepto Pulso)

Paleta: tinta `#111318` · acento `#FF5A1F` · fondo claro `#F2F2EE`. Tipografía del nombre: Space Grotesk 600.

## Contenido

| Archivo | Uso |
|---|---|
| `app-icon.svg` / `app-icon.png` | **Fuente para `tauri icon`** (1024×1024, transparente, con margen al estilo macOS) |
| `app-icon-fullbleed.svg` / `.png` | Alternativa a sangre completa (sin margen), por si prefieres ese aspecto en Windows/Linux/Android |
| `logo/galvani-mark.svg` / `.png` | Marca sobre fondo claro |
| `logo/galvani-mark-on-dark.svg` / `.png` | Marca sobre fondo oscuro |
| `logo/galvani-mark-mono.svg` | Monocromo con `currentColor` (para la UI de React) |
| `logo/galvani-lockup.svg` | Marca + nombre (el texto usa Space Grotesk, no está convertido a trazos) |
| `web/favicon.svg`, `web/favicon.ico`, `web/apple-touch-icon.png` | Frontend (Vite `public/`) |
| `tray/tray-icon*.png` / `.svg` | Icono de bandeja/menú, negro sobre transparente, pensado como *template* en macOS |

## Generar los iconos de Tauri v2

1. Copia `app-icon.png` a la raíz del proyecto (junto a `package.json`).
2. Ejecuta:

```bash
npm run tauri icon            # usa ./app-icon.png por defecto
# o explícito:
npm run tauri icon ./app-icon.png -- -o src-tauri/icons
```

El comando genera en `src-tauri/icons` los PNG de escritorio (32x32, 128x128, 128x128@2x, icon.png), `icon.icns`, `icon.ico` y los logos de Microsoft Store (Square*Logo, StoreLogo). Si tienes `src-tauri/gen/android` o `gen/apple` inicializados, también genera los de Android/iOS. Acepta también el `.svg` como entrada.

3. Comprueba que `src-tauri/tauri.conf.json` los referencia:

```json
"bundle": {
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.icns",
    "icons/icon.ico"
  ]
}
```

## Frontend

Copia `web/*` a `public/` y en `index.html`:

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="any">
```

## Bandeja del sistema (opcional)

Copia `tray/tray-icon@2x.png` a `src-tauri/icons/`. En macOS márcalo como template para que se adapte a menú claro/oscuro:

```rust
use tauri::{image::Image, tray::TrayIconBuilder};

let icon = Image::from_bytes(include_bytes!("../icons/tray-icon@2x.png"))?;
TrayIconBuilder::new()
    .icon(icon)
    .icon_as_template(true)
    .build(app)?;
```

(Requiere la feature `image-png` de `tauri` en `Cargo.toml`.)
