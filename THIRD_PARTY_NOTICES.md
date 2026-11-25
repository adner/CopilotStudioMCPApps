# Third-party notices

This project includes code and text copied or adapted from the projects below.
Dependencies installed through npm keep their own licenses in `node_modules`.

## CopilotKit

- **Source:** https://github.com/CopilotKit/CopilotKit and https://github.com/CopilotKit/OpenIntelligentUI
- **License:** MIT
- **Used in:**
  - `src/vendor/copilotkit-open-generative-ui.js`: the Open Generative UI renderer, copied verbatim from
    `@copilotkit/react-core` 1.90.2.
  - `genui/copilotkit-contract.ts`: the `generateSandboxedUi` tool description and argument schema, from
    `@copilotkit/shared` and `@copilotkit/react-core` 1.90.2.
  - `genui/prompt.ts`: the generator prompt, adapted from Open Intelligent UI's agent prompt and skills
    and from `@copilotkit/react-core`'s default design skill.

```
The MIT License

Copyright (c) Atai Barkai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Libraries loaded at runtime

Generated UIs load three.js (MIT), GSAP (GSAP Standard License), D3 (ISC) and Chart.js (MIT)
from public CDNs in the user's browser. They aren't included in this repository.
