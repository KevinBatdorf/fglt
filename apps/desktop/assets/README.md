# Desktop assets

Drop these files here for the desktop app build.

| File | Purpose | Notes |
|---|---|---|
| `screenshot.png` | Hero shot embedded near the top of the project README | Capture the desktop app open to a populated detail or home view. The detail page with screenshots gallery + scores stack is the most flattering. |
| `icon-1024.png` | Master app icon — single 1024×1024 PNG with transparent background | Source artwork for all platform-specific icons below |
| `icon.ico` | Windows app icon | Generated from `icon-1024.png` by `scripts/build-icons.sh`; multi-size 16/32/48/64/128/256 |
| `icon.iconset/` | macOS app icon set | Generated from `icon-1024.png` by `scripts/build-icons.sh`; standard Apple icon ladder |
| `icon-512.png` | Linux app icon | Generated from `icon-1024.png` by `scripts/build-icons.sh` |

## Regenerating icons

```bash
cd apps/desktop
bash scripts/build-icons.sh
```

(Requires ImageMagick. Re-run whenever `icon-1024.png` changes.)
