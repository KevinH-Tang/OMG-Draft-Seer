# Offline Layout Detection

`detect-layout.py` refines an existing 2560x1440 layout from center icon-content evidence,
with Canny used only as a local supporting signal.
It is an offline calibration tool. The web application continues to load the resulting
fixed JSON file and does not require Python or OpenCV at runtime.

Use Python with NumPy and OpenCV wheels available from your package source:

```powershell
py -3 -m pip install -r requirements-layout.txt
py -3 scripts/detect-layout.py `
  --method lab `
  --image "C:\Users\61797\Pictures\screenshot.png" `
  --seed "C:\Users\61797\Pictures\omg-layout-2560x1440.json" `
  --output "C:\Users\61797\Pictures\omg-layout-refined.json" `
  --debug "C:\Users\61797\Pictures\omg-layout-debug.png" `
  --edges "C:\Users\61797\Pictures\omg-layout-edges.png"
```

The debug image draws the actual center crop used by the matcher twice: cyan is the
hand-tuned seed and magenta is the automatic candidate. The label is candidate-vs-seed
IoU. The output JSON always contains the automatic candidate; high agreement is reported
as comparison information only, not used to override either layout. Inspect the image
before loading an output JSON into the web application. The optional Canny image is a
diagnostic input only; outer metallic frames are not treated as the matching target.

The detector deliberately refines each seed rectangle independently. It does not force
uniform width, height, or spacing, so the trapezoid projection of hero and ability rows
is preserved.

Use `--method lab` for color-content scoring, `--method canny` for an edge-only baseline,
`--method hybrid` to combine both, or `--method bright-dark` to score a bright icon crop
against its darker outer ring. The default `0.78` IoU threshold is a report-only
high-agreement marker. Run all methods against the same seed and compare their
overlay PNG and report JSON files before choosing a fixed layout.
