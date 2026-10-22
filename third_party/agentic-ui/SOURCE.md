# agentic-ui interaction adaptation

- Upstream: https://github.com/antdigital-ai/agentic-ui
- Pinned commit: `685f0a4bc14e2ef1a736a678eedd9fdc2a7a5f95`
- License: MIT; preserved at [LICENSE](LICENSE)
- Local adaptation: `web/src/features/chat/ChatLayout.tsx` and
  `web/src/features/chat/ChatComposer.tsx` reproduce the ChatLayout /
  WelcomeMessage interaction model (scrollable message region, fixed composer,
  empty-state welcome) with PaperLab primitives.

No upstream package or antd runtime is bundled. The upstream `ChatLayout` and
`WelcomeMessage` components depend on antd ConfigProvider/CSS-in-JS, framer
motion animation and React 19-oriented peers; importing the whole component
library would add a large unrelated runtime. This adaptation keeps the same
public interaction pattern while preserving the existing React 18 bundle and
licence audit surface.

If future work imports upstream source instead of adapting the interaction,
retain this notice and upstream copyright.
