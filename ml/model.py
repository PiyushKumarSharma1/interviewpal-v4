import torch
import torch.nn as nn
import torch.nn.functional as F


class Head(nn.Module):
    def __init__(self, n_embd, head_size, block_size, dropout):
        super().__init__()
        self.key = nn.Linear(n_embd, head_size, bias=False)
        self.query = nn.Linear(n_embd, head_size, bias=False)
        self.value = nn.Linear(n_embd, head_size, bias=False)
        self.register_buffer("tril", torch.tril(torch.ones(block_size, block_size)))
        self.dropout = nn.Dropout(dropout)

    def forward(self, x):
        batch_size, time_steps, channels = x.shape
        key = self.key(x)
        query = self.query(x)
        weights = query @ key.transpose(-2, -1) * (channels ** -0.5)
        weights = weights.masked_fill(self.tril[:time_steps, :time_steps] == 0, float("-inf"))
        weights = F.softmax(weights, dim=-1)
        weights = self.dropout(weights)
        value = self.value(x)
        return weights @ value


class MultiHeadAttention(nn.Module):
    def __init__(self, num_heads, head_size, n_embd, block_size, dropout):
        super().__init__()
        self.heads = nn.ModuleList(
            [Head(n_embd, head_size, block_size, dropout) for _ in range(num_heads)]
        )
        self.projection = nn.Linear(num_heads * head_size, n_embd)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x):
        output = torch.cat([head(x) for head in self.heads], dim=-1)
        output = self.projection(output)
        return self.dropout(output)


class FeedForward(nn.Module):
    def __init__(self, n_embd, dropout):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_embd, 4 * n_embd),
            nn.ReLU(),
            nn.Linear(4 * n_embd, n_embd),
            nn.Dropout(dropout),
        )

    def forward(self, x):
        return self.net(x)


class Block(nn.Module):
    def __init__(self, n_embd, num_heads, block_size, dropout):
        super().__init__()
        head_size = n_embd // num_heads
        self.self_attention = MultiHeadAttention(num_heads, head_size, n_embd, block_size, dropout)
        self.feed_forward = FeedForward(n_embd, dropout)
        self.ln1 = nn.LayerNorm(n_embd)
        self.ln2 = nn.LayerNorm(n_embd)

    def forward(self, x):
        x = x + self.self_attention(self.ln1(x))
        x = x + self.feed_forward(self.ln2(x))
        return x


class MiniGPT(nn.Module):
    def __init__(self, vocab_size, block_size, n_embd, num_heads, num_layers, dropout):
        super().__init__()
        self.block_size = block_size
        self.token_embedding_table = nn.Embedding(vocab_size, n_embd)
        self.position_embedding_table = nn.Embedding(block_size, n_embd)
        self.blocks = nn.Sequential(
            *[Block(n_embd, num_heads, block_size, dropout) for _ in range(num_layers)]
        )
        self.ln_f = nn.LayerNorm(n_embd)
        self.lm_head = nn.Linear(n_embd, vocab_size)

    def forward(self, idx, targets=None):
        batch_size, time_steps = idx.shape
        token_embeddings = self.token_embedding_table(idx)
        position_embeddings = self.position_embedding_table(torch.arange(time_steps, device=idx.device))
        x = token_embeddings + position_embeddings
        x = self.blocks(x)
        x = self.ln_f(x)
        logits = self.lm_head(x)

        loss = None
        if targets is not None:
          batch, time, channel = logits.shape
          logits = logits.view(batch * time, channel)
          targets = targets.view(batch * time)
          loss = F.cross_entropy(logits, targets)

        return logits, loss

