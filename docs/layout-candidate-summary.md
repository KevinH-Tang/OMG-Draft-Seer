# Automatic Layout Candidate Summary

## Scope

The offline detector refines a hand-tuned `omg-layout-2560x1440.json`.
It does not run in the web application and does not replace manual judgment.

## Candidate Rules

- Each slot starts from the hand-tuned rectangle.
- Search is local: position can move by at most `12px` in either direction.
- Size is limited to a `0.92` through `1.08` scale of the hand-tuned rectangle.
- Every slot is independent, preserving the trapezoid projection instead of forcing a uniform grid.
- Scoring and visualization use the actual center crop consumed by the matcher, at a `0.76` crop ratio.

## Comparison Output

The debug overlay draws both actual matcher crops:

- Cyan: hand-tuned seed crop.
- Magenta: automatic candidate crop.
- Label: candidate-to-seed IoU.

Automatic candidate JSON files always contain the detected candidate. `highAgreement` is report-only and never selects a layout on behalf of the user.

## Methods

| Method | Scoring signal | High-agreement candidates on the reference screenshot |
| --- | --- | ---: |
| `canny` | Center-crop edge density | 11 / 60 |
| `lab` | High icon chroma and low outer-ring chroma | 28 / 60 |
| `hybrid` | Lab chroma plus Canny evidence | 28 / 60 |
| `bright-dark` | Bright, chromatic crop against a darker outer ring | 30 / 60 |

`bright-dark` is the current first comparison method because it best matches the bright-icon and dark-frame visual structure of the reference screenshot. The final fixed layout must still be chosen after visual comparison.

## Invocation

```powershell
py -3 scripts/detect-layout.py `
  --method bright-dark `
  --image "C:\Users\61797\Pictures\screenshot.png" `
  --seed "C:\Users\61797\Pictures\omg-layout-2560x1440.json" `
  --output "C:\Users\61797\Pictures\omg-layout-bright-dark.json" `
  --debug "C:\Users\61797\Pictures\omg-layout-bright-dark.png"
```
