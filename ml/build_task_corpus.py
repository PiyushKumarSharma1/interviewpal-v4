import json
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data" / "mygpt"
OUTPUT_PATH = ROOT_DIR / "data" / "corpus.txt"


def format_value(value, indent=0):
    prefix = " " * indent

    if isinstance(value, dict):
        lines = []
        for key in sorted(value.keys()):
            child = value[key]
            if isinstance(child, (dict, list)):
                lines.append(f"{prefix}{key}:")
                lines.append(format_value(child, indent + 2))
            else:
                lines.append(f"{prefix}{key}: {child}")
        return "\n".join(lines)

    if isinstance(value, list):
        lines = []
        for item in value:
            if isinstance(item, (dict, list)):
                lines.append(f"{prefix}-")
                lines.append(format_value(item, indent + 2))
            else:
                lines.append(f"{prefix}- {item}")
        return "\n".join(lines)

    return f"{prefix}{value}"


def load_examples():
    examples = []
    for file_path in sorted(DATA_DIR.glob("*.jsonl")):
        with file_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                raw = line.strip()
                if not raw:
                    continue
                example = json.loads(raw)
                examples.append(example)
    return examples


def format_example(example):
    task_type = example.get("taskType", "coaching_note")
    input_payload = example.get("input", {})
    output = str(example.get("output", "")).strip()

    return "\n".join(
        [
            f"### TASK: {task_type}",
            "INPUT:",
            format_value(input_payload),
            "OUTPUT:",
            output,
        ]
    ).strip()


def main():
    examples = load_examples()

    if not examples:
        raise SystemExit("No task examples found in data/mygpt.")

    corpus = "\n\n".join(format_example(example) for example in examples)
    OUTPUT_PATH.write_text(corpus + "\n", encoding="utf-8")
    print(f"Wrote {len(examples)} task examples to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
