import json
import os
import socket
import sys


def respond(payload):
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


if os.environ.get("MYGPT_DISABLE_NETWORK") == "1":
    class DisabledSocket(socket.socket):
        def __new__(cls, *args, **kwargs):
            raise RuntimeError("Network access is disabled for mygpt worker")

    socket.socket = DisabledSocket


try:
    import torch
    import torch.nn.functional as F

    from model import MiniGPT
except Exception as exc:  # pragma: no cover - startup safeguard
    respond({
        "ok": False,
        "error": str(exc),
    })
    sys.exit(1)


DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


class LoadedTokenizer:
    def __init__(self, stoi, itos):
        self.stoi = stoi
        self.itos = {int(k): v for k, v in itos.items()} if isinstance(next(iter(itos.keys())), str) else itos

    def encode(self, s: str):
        return [self.stoi[c] for c in s if c in self.stoi]

    def decode(self, ids):
        return "".join(self.itos[int(i)] for i in ids)


@torch.no_grad()
def generate_with_controls(model, idx, max_new_tokens, temperature=0.8, top_k=12):
    for _ in range(max_new_tokens):
        idx_cond = idx[:, -model.block_size :]
        logits, _ = model(idx_cond)
        logits = logits[:, -1, :] / max(temperature, 1e-5)

        if top_k is not None:
            values, _ = torch.topk(logits, min(top_k, logits.size(-1)))
            cutoff = values[:, -1].unsqueeze(-1)
            logits = torch.where(logits < cutoff, torch.full_like(logits, float("-inf")), logits)

        probs = F.softmax(logits, dim=-1)
        next_idx = torch.multinomial(probs, num_samples=1)
        idx = torch.cat((idx, next_idx), dim=1)

    return idx


def load_checkpoint():
    ckpt = torch.load("model.pt", map_location=DEVICE)
    model = MiniGPT(
        vocab_size=ckpt["vocab_size"],
        block_size=ckpt["block_size"],
        n_embd=96,
        num_heads=4,
        num_layers=3,
        dropout=0.1,
    ).to(DEVICE)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    tok = LoadedTokenizer(ckpt["stoi"], ckpt["itos"])
    return ckpt, model, tok


def squash_text(value: str) -> str:
    return " ".join((value or "").split())[:240]


def main():
    try:
        request = json.loads(sys.stdin.read() or "{}")
        mode = request.get("mode", "generate")
        ckpt, model, tok = load_checkpoint()

        if mode == "health":
            respond({
                "ok": True,
                "version": f"minigpt-step-{ckpt.get('step', 0)}",
                "step": ckpt.get("step", 0),
                "device": DEVICE,
            })
            return

        prompt = request.get("prompt", "InterviewPal")
        max_new_tokens = int(request.get("maxNewTokens", 80))
        encoded_prompt = tok.encode(prompt) or tok.encode("InterviewPal")
        context = torch.tensor([encoded_prompt], dtype=torch.long).to(DEVICE)
        output = generate_with_controls(model, context, max_new_tokens=max_new_tokens)[0].tolist()
        raw_text = tok.decode(output)
        note = squash_text(raw_text.replace(prompt, "", 1))

        if not note:
            note = "Lead with your strongest project, map it to the role, and quantify the impact."

        respond({
            "ok": True,
            "version": f"minigpt-step-{ckpt.get('step', 0)}",
            "step": ckpt.get("step", 0),
            "note": note,
            "rawText": squash_text(raw_text),
            "warnings": [],
        })
    except Exception as exc:
        respond({
            "ok": False,
            "error": str(exc),
        })
        sys.exit(1)


if __name__ == "__main__":
    main()
