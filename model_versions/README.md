# mygpt Checkpoint Workflow

InterviewPal treats `mygpt` as a versioned local model, not a file that gets silently replaced.

Suggested workflow:

1. Build the task corpus:
   `npm run build:mygpt-corpus`
2. Train or finetune:
   `npm run train:mygpt`
3. Run evals:
   `npm run eval:mygpt`
4. Promote only if eval thresholds pass:
   `npm run promote:mygpt -- --candidate /absolute/path/to/candidate-model.pt`

The promotion script archives the previous production checkpoint, records eval metadata, and updates `model_versions/manifest.json`.
