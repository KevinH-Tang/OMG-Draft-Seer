# Golden screenshot fixtures

Store approved `2560x1440` PNG, JPG, or JPEG screenshots and a matching JSON file here. Original
fixture files are not converted, renamed, or replaced. Each JSON file uses the same basename and
contains the expected `slotIndex -> abilityId` mapping for all 60 candidate slots.

The `resolution/` and `badcase/` subdirectories contain approved screenshots used to verify image
decoding and projected layout behavior across resolutions and known edge cases. These nested
fixtures do not require matching label maps unless a recognition assertion explicitly uses them.
They are source test data and must remain tracked; generated logs and test reports belong in the
ignored output paths instead.

Generate or refresh labels from the current layout, snapshot, and template signatures with:

```sh
npm run build:fixture-labels
```

The fixture regression test verifies dimensions, label coverage, and that template recognition
matches every stored label. Only add screenshots whose redistribution has been approved.
