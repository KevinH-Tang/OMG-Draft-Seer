# Golden screenshot fixtures

Store approved `2560x1440` PNG, JPG, or JPEG screenshots and a matching JSON file here. Original
fixture files are not converted, renamed, or replaced. Each JSON file uses the same basename and
contains the expected `slotIndex -> abilityId` mapping for all 60 candidate slots.

Generate or refresh labels from the current layout, snapshot, and template signatures with:

```sh
npm run build:fixture-labels
```

The fixture regression test verifies dimensions, label coverage, and that template recognition
matches every stored label. Only add screenshots whose redistribution has been approved.
