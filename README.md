# pi-hn

A simple Hacker News front-page reader extension for [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

![pi-hn screenshot](https://raw.githubusercontent.com/calesennett/pi-hn/refs/heads/main/assets/pi-hn.png)

## Features

- `/hn` command opens a selectable front-page list
- `j/k` (and arrow keys) navigate the list
- `a` or `Enter` opens the article URL
- `x` fetches and parses the selected article (via Readability) and adds it to session context for follow-up prompts
- `c` opens comments in browser
- Read tracking is stored in a local JSON file at `~/.pi/agent/data/pi-hn/db.json` (or `$PI_CODING_AGENT_DIR/data/pi-hn/db.json`)

## Install

```bash
pi install npm:@calesennett/pi-hn
```

## Local development

In this repo, load the extension directly:

```bash
pi -e ./extensions/hn.ts
```
