# A reference architecture for the development of GLSP-based web modeling tools

Haydar Metin & Dominik Bork. _Software and Systems Modeling_ 24(6), 1869–1895 (2025).
DOI: [10.1007/s10270-024-01257-y](https://doi.org/10.1007/s10270-024-01257-y). Published 10
January 2025 (online), issue date December 2025.

Licence: **CC BY 4.0** ("Open Access This article is licensed under a Creative Commons
Attribution 4.0 International License, which permits use, sharing, adaptation, distribution and
reproduction in any medium or format, as long as you give appropriate credit to the original
author(s) and the source, provide a link to the Creative Commons licence, and indicate if changes
were made."). This file transcribes the parts of the paper relevant to `#74`; it is not a verbatim
copy of the whole paper. Figures are redrawn as text below, not reproduced as images, each
prefixed with the paper's own figure number and caption.

Transcribed by a build session for [istar-ts#78](https://github.com/vieirin/istar-ts/issues/78),
part of [istar-ts#74](https://github.com/vieirin/istar-ts/issues/74). Section numbers below match
the paper exactly, so every section reference in `#74`'s stages (S0–S4) resolves here.

## 1 Introduction

The paper is an extended version of a MODELS 2023 conference paper (Metin & Bork, "On developing
and operating GLSP-based web modeling tools: lessons learned from BIGUML"). The extensions: a
richer related-work discussion (§2.1), the history of the reference architecture (§3.5), a major
extension of the reference architecture itself (§4) with implementation examples (§5) and new
figures, and an extended discussion with recommendations and a vision (§6).

## 2 Graphical language server platform

GLSP is an extensible open-source framework (Eclipse Foundation) for building custom diagram
editors on web technologies. It extends the Language Server Protocol (LSP) idea from text
documents to graphical models: a 2D (row, column) textual position becomes a 2+D graphical space
where elements occupy an area and can compose children; plain character edits become complex
graphical operations (create a node, connect two nodes with constraints, move an element inside
another). GLSP 2.2.1 was the current major release as of July 2024.

### GLSP core architecture (Fig. 1)

> Caption: "GLSP core architecture [18]"

```
GLSP Client (SVG/TS, hosted in a browser, Theia, VS Code, Eclipse RCP, …)
        │
        │  Graphical Language Server Protocol (bidirectional, JSON actions)
        ▼
GLSP Server  ──reads/writes──▶  Source Model (e.g. a UML model)
```

- **Server framework** — builds a particular GLSP diagram server for a language (UML, a DSL).
- **Client framework** — builds a particular GLSP client: rendering styles for the concrete
  syntax, user interaction.
- **Protocol** — the messages exchanged between client and server; the graphical analogue of LSP.
- **Platform integration** — reusable components that embed a GLSP client into Eclipse RCP, Atom,
  VS Code, etc.
- **Source Model** — the model being edited.

The server owns all language smarts (model management, validation, manipulation); the client only
renders and relays user interaction. This split is deliberately client-agnostic: any client that
speaks the protocol can drive any server.

**Action & action handlers.** Actions are structured messages between client and server,
implementing the Messaging and Command patterns. ActionHandlers are specific to one action type
and execute the corresponding state change — e.g. the handler for a `CreateOperation` (an
"Operation" is "a special Action that modifies the model source", per the paper's own footnote 5)
adds the new element. GLSP's command stack gives multi-step undo/redo for free. The GLSP
documentation covers actions and handlers in depth.

**Built-in functionality.** Nested nodes, customizable edge routing points, copy-paste,
experimental keyboard-only navigation (accessibility), keyboard shortcuts, experimental helper
lines for alignment, undo/redo, ghost elements for previewing changes before applying them.

### 2.1 Related work

**2.1.1 Related frameworks and platforms** (not GLSP-based, same problem space):

- **SiriusWeb** — low-code web diagram editor, successor to Eclipse Sirius over EMF/Ecore
  metamodels. Real-time collaborative, automated layout, webhooks for third-party integration
  (comparable in spirit to GLSP actions).
- **AToMPM** — cloud DSM environment with model transformations; traditional metamodeling
  (specializes a generic class-diagram language); client/server split like GLSP but no
  intuitive platform integration.
- **WebGME** — successor to Eclipse GME; tight language-engineering/language-use integration,
  live reflection of metamodel changes; REST Model API; plug-in extensibility.
- **CINCO Cloud** — successor to CINCO; itself **uses GLSP and Sprotty** for editors/rendering;
  language server configured with Xtext/Xtend.
- **Picto Web** — generates HTML/Graphviz/PlantUML views of models via model-to-text rules; not a
  full editor.
- **KIELER** — close to GLSP (also LSP-extended Sprotty, same client/server update flow:
  edit → source model → push updated model to client) but **text-first** (diagram generated and
  kept consistent from a textual concrete syntax), vs. GLSP's **diagram-first** approach.
  Advanced auto-layout.
- **jjodel** (2023) — cloud reflective modeling in TS/JS, aimed at low setup/configuration
  overhead; Model API separates externalization from view/rendering; events mapped to actions,
  as in GLSP.
- **Gentleman** — lightweight projectional editor; concept/CRUD API separated from a projection
  component (graphical/tabular/textual/widget views) and an editor component (interaction,
  import/export, extension points).
- **Dandelion** — cloud language-engineering workbench, React + vis.js front end, Node.js/TS back
  end, ELK for auto-layout, DROID recommender for metamodel properties during language
  engineering; independent of GLSP today but the authors want to align with it.

**2.1.2 Related experience with GLSP** (papers reporting GLSP tool-building experience):

- Walker et al. — combined an Xtext textual syntax with a GLSP graphical syntax for a DSL for
  distributed real-time systems; used GLSP validation and VS Code integration.
- Walsh et al. — hybrid language-server architecture: LSP (textual) + GLSP (graphical) sharing one
  abstract syntax, applied to a UML-RT tool.
- Hölzl & Barner — migrated AutoFOCUS 3 (originally Eclipse RCP) to Theia + GLSP, with a separate
  EMF-based model server for validation. Reported challenges: **separation of concerns** (server
  and client built/deployed separately) and **dependency injection** (overriding default behaviour
  via DI can grow inconsistent/complex); recommend thorough cross-component documentation and more
  testing support against invalid injected code.
- Ali et al. — evaluated several web-modeling-tool frameworks, picked GLSP, built **CaMCOA
  Cloud** (Eclipse GLSP + Theia + a dedicated model server). Reported challenges: GLSP codebase
  churn, lack of documentation/best practices — the gap this paper addresses.
- McLeod & Cox — practical evaluation stressing GLSP's code-focused nature; alternative
  server/client separations, informed by prior Smalltalk graphical-tool experience; some of their
  criticism (lines of code required) is the kind this paper's reference architecture aims to
  mitigate.
- Popov et al. — compared low-code platforms for extensibility: Langium best for language
  engineering, **GLSP best for diagram editing** among those studied.

**2.1.3 Synopsis.** No related platform has a reported reference architecture or reference
implementation at this level of detail — documentation plus a short tutorial plus a shallow
architecture diagram is typical. Experience reports agree GLSP is flexible and produces
well-received client-side UX, but all flag the server/client separation overhead, redeployment
cost, end-to-end testing cost, and sparse documentation/best practices/reference implementations
— exactly what this paper supplies.

## 3 Developing GLSP-based web modeling tools

GLSP implementation options (combinable): **GLSP-Server** in Java or TypeScript/Node; **Source
Model** access via EMF, EMF.cloud, or the GModel saved directly, or other formats (XML, JSON,
remote); **Tool Platform** — any web client, or integrations for Eclipse Theia, VS Code, Eclipse
RCP. GLSP ships getting-started templates for common combinations but does not require them.

### Fig. 2 — Development and operation process for GLSP-based web modeling tools

> Caption: "Development and operation process for GLSP-based web modeling tools"

```
Preliminary Phase ──▶ Development Phase ──▶ Integration Phase ──▶ Deployment Phase
 │                      │                      │                     │
 ├─ Defining Tool Scope │  ┌──────────────┐    │  (optional per      │  Tool/Server/Source
 └─ Defining Technology │  │  Planning    │    │   tool platform:    │  combination examples
    Stack               │  │     ↓        │    │   VS Code / Theia / │  shown in the paper's
                         │  │ Extending    │    │   browser)          │  figure:
                         │  │ Source Model │    │                     │   VS Code – TS  – EMF
                         │  │     ↓        │    │                     │   Theia   – Java – XML
                         │  │ Implementation│   │                     │   Browser – TS  – EMF
                         │  │     ↓        │
                         │  │ Review ──────┘ (loops back to Planning) │
                         │  └──────────────┘
```

1. **Preliminary phase** — set scope (which diagram elements, single vs. multiple diagram types,
   which custom features beyond GLSP's basics) and technology stack (client: TypeScript + SVG
   knowledge; server: Java or TypeScript — same-language full stack eases things, and the
   TypeScript server is kept aligned with the Java one; source-model format: EMF.cloud reuses
   Ecore tooling, or XML/JSON directly). Decisions here are meant to be stable — later phases
   depend on them.
2. **Development phase** — iterative. Two development styles:
   - **Feature-oriented**: implement one feature through every architectural layer before the
     next. Faster results, independent/incremental work, but needs broad cross-layer experience.
     Better suited to **small teams and small metamodels (< ~30 elements)**, with none or only
     selected extra functionality beyond CRUD.
   - **Architecture-oriented**: multiple features developed per single architectural component, by
     separate teams per component (front-end/back-end-style separation). Better isolation, more
     organizational overhead. Better suited to **large metamodels and advanced features**
     (transformation, codegen, AI assistants) and multi-service architectures.
   - Steps regardless of style: **3.2.1 Planning** (bottom-up: update the source model first, then
     server, then client) → **3.2.2 Extending the source model** → **3.2.3 Implementation** →
     **3.2.4 Review** (unit/integration/e2e; GLSP ships **GLSP-Playwright** for e2e testing
     graphical elements with less boilerplate).
3. **Integration phase** — per-tool-platform work needed only when platform-specific features
   (I/O, context menus) are used; otherwise the GLSP-Client is already cross-platform. Optional,
   and can be folded into the development phase.
4. **Deployment phase** — assumes CI/CD after merge. Deployment options: **integrated server**
   (client+server, one machine), **separated server** (different machines), **multiple servers**,
   **no server** (client has all necessary knowledge). No option is universally best — combine as
   needed. Deployment scenarios: **registry** (publish client/server to NPM/Maven for reuse),
   **standalone** (client loaded like a library into a web app, server hosted independently),
   **Eclipse Theia** (containerized, good for spinning up clean per-user instances — staging/
   testing), **VS Code** (package as `.vsix`; recommended to bundle and auto-start the server with
   the extension).

### 3.5 Framework development history

BIGUML's and the framework's history, used as the evidence base for the reference architecture:

- **2021 — initial development.** BIGUML built alongside early GLSP and a basic model server;
  foundational, high-learning period.
- **2022 — major milestones.** GLSP 1.0.0 (end of June 2022) brought a more stable architecture;
  BIGUML underwent a major rewrite for multi-diagram support and to track GLSP more closely — the
  first versions of this paper's concepts appear here.
- **2023–2024 — toward a generic framework.** BIGUML's general components abstracted into a
  reusable framework, aimed beyond UML. GLSP 2.0.0 adopted without issues.
- **2024 — independence from Eclipse IDE.** Build system moved to Gradle so development no longer
  requires the Eclipse IDE (VS Code or any IDE now works) — the most-requested change from student
  developers.

Evaluation basis: 50+ Master's-level student developers (already working part-time in industry),
~6,250 h of coursework effort plus ~7,575 h (~50 person-months) across 9 Master's and 6 Bachelor's
theses that pushed the framework for visualization, accessibility, and collaborative-modeling
features.

## 4 Reference architecture

Because GLSP's dependency injection gives developers full architectural freedom — which can hurt
maintainability if unguided — the reference architecture applies three patterns:

- **Separation of concerns (SoC).** Split the system (model server, mappers, GLSP-Client/Server,
  …) into components with single, well-scoped concerns, at both the architectural and the code
  level. Improves modularity, maintainability, reusability, and lets teams iterate modules
  independently.
- **Single source of truth (SSoT).** The model is modifiable/readable from one place only, to
  avoid corruption or stale reads. A model server strengthens this by decoupling the source model
  from GLSP so multiple services share one model — at the cost of extra system complexity and
  maintenance, which can be an obstacle for small teams/apps. Without a model server, organizing
  modification code into distinct packages/modules still reinforces this.
- **Single responsibility principle (SRP).** Every component has exactly one responsibility, from
  implementation up to server operation and services — multi-responsibility components are harder
  to test and maintain.

These patterns are embodied in a released, reusable framework that extends the GLSP-Server:
**bigGLSP-framework** ([github.com/glsp-extensions/bigGLSP-framework](https://github.com/glsp-extensions/bigGLSP-framework),
Zenodo [10.5281/zenodo.14316697](https://doi.org/10.5281/zenodo.14316697)).

### 4.1 Concepts

Dependency injection is the central mechanism, used throughout to modularize and loosely couple
code. On top of it, functionality splits into three module categories: **core**, **tool**, and
**diagram** features.

#### 4.1.1 Modules and interactions

Features split by **language-independence**: Core and Tool features are language-independent (the
paper calls them the general modeling capabilities); Diagram features are language-dependent
(language-specific operations).

### Fig. 3 — Features and their modules

> Caption: "Features and their modules"

```
┌───────────────────────────── Features ─────────────────────────────┐
│ Diagram tier (orange)                                               │
│   [Diagram Module]──API──▶        [Diagram Module]──API──▶          │
│         │ uses tool/core APIs            │ uses tool/core APIs      │
├─────────┼───────────────────────────────┼───────────────────────────┤
│ Tool tier (green)                        │                          │
│   [Tool Module]◀──API──▶[Tool Module]────┘                          │
│         │ uses core API         │ uses core API                     │
├─────────┴───────────────────────┴───────────────────────────────────┤
│ Core tier (blue)                                                     │
│   [Core Module] ──API──▶                                             │
│         │ interfaces only with the server framework below            │
├───────────────────────────────────────────────────────────────────┤
│ [Server-Framework: GLSP, Modelserver, …]                             │
└───────────────────────────────────────────────────────────────────┘
```

Reading rules: diagram modules call tool-module and core-module APIs; tool modules call other tool
modules' and the core module's APIs; the **core module is isolated** — it only talks to the
underlying server framework, and never depends on tool or diagram modules, with one exception: the
core module **registers/installs** (binds) the other modules, because DI requires the core module
to be the one module that can exist standalone. Colour convention used in later figures too:
**diagram = orange, tool = green, core = blue**, and arrows originate from the module doing the
calling.

- **Core feature** — the glue between the server framework (GLSP-Server, model server, …) and the
  other modules; no language-specific knowledge; loads modules, manages the application, isolates
  the rest of the system from upstream server-framework changes.
- **Tool features** — implement functionality GLSP doesn't provide out of the box (outline view,
  property palette, minimap, copy-paste, autocomplete, PlantUML import/export, …) by using core
  interfaces (DI). They expose their own APIs too, so other tool and diagram features can extend
  them.
- **Diagram features** — language-specific; access the source model directly; implement CRUD for
  the metamodel elements, using core and selected tool features; responsible for keeping source
  model modifications controlled and consistent.

#### 4.1.2 Manifests & contributions

Each feature module isolates its functionality and interacts with other modules through
**manifests** and **contributions**, via DI.

### Fig. 4 — Manifests and contributions overview

> Caption: "Manifests and contributions overview"

```
Diagram Module ───────────────contribute───────────────▶┐
  │                                                      │
  ▼ (contains, same shape repeated for Tool and Core)    │
Tool Module ─────────────────────contribute──────────────┤
┌─────────────────────────────────────────────────────┐  │
│ Module                        Internal-API           │  │
│  Manifest ──bind──▶ Class ──use──▶ [□□□]              │  │
│     ▲                  ┊...................           │  │
│     │                  ▼                              │  │
│     │               Contribution ◀───────contribute────┘(from Diagram)
│     │                  │ expose                        │
│     │                  ▼                                │
│     └─────────────── Interface  (External-API)          │
└─────────────────────────────────────────────────────┘   │
                        contribute ▲────────────────────────┘ (Tool → Core)
Core Module
┌─────────────────────────────────────────────────────┐
│ Module                        Internal-API           │
│  Manifest ──bind──▶ Class ──use──▶ [□□□]              │
│     ▲                  ┊...................   use────▶ (downward: other Core classes)
│     │                  ▼                              │
│     │               Contribution ◀──contribute (Tool)  │
│     │                  │ expose                        │
│     │                  ▼                                │
│     └─────────────── Interface (External-API)           │
└─────────────────────────────────────────────────────┘
                        │ use
                        ▼
Server-Framework ──API──▶
```

- **Manifests** — every feature module has one; it defines the contributions the module makes, and
  acts as the glue that registers implementations into the DI container against a contribution's
  exposed operations. Manifests can install other manifests, so complex dependency graphs compose
  hierarchically.
- **Contributions** — provided by core and tool features; they let a feature delegate execution
  logic to other features (e.g. delegating a GLSP create operation, or supplying property-palette
  content from a diagram module). Core contributions let other features extend/override default
  server-framework behaviour; tool features use core contributions to build new capabilities and
  also expose their own contribution points for diagram features, giving diagram features access
  to source models via tool features. Technically a contribution exposes operations other modules
  register implementations against.

Together, manifests declare the contributions they fulfil, so a module exposing a contribution
point can rely on its needs being met by whichever manifest wires an implementation in. §5.1.1
shows this concretely for BIGUML.

**Limitations.** Reliance on a third-party DI framework (Guice for Java, InversifyJS for
TypeScript) varies in support/configuration complexity, can grow development time and the learning
curve, and can introduce misconfiguration errors — particularly for teams new to DI. Framework
choice needs to balance ease of use, flexibility, and architectural goals.

#### 4.1.3 Source model representation separation

A **source model** (the underlying data, e.g. a UML or ER model) can be shown through several
**diagram representations** — different visual/interactive views of the same source model (e.g. a
UML class diagram vs. a sequence diagram of the same model). Representations differ in which
details/interactions they allow (a node may show fewer details in a communication diagram than in
a sequence diagram) and can be read-only. **Feature modules must always know the currently active
representation** to enforce representation-specific constraints. §5.1.2 shows this for BIGUML.

### Fig. 5 — Representation separation and flow similarity (class creation example)

> Caption: "Representation separation and flow similarity using the class creation as an example"

```
Diagram tier
  Manifest ──has──▶ Representation
     │ bind
     ▼
  CreateClassHandler ───extends───────────────────┐
                                                   │
Core tier                                         │
  CreateContribution ──expose──▶ CreateHandler ◀───┘ implement
     │ use                              ▲
     ▼                                  │ implement
  Registry ◀──use──▶ RepresentationProvider
     ▲ use                 ▲ use
     │                     │
  RequestCreateHandler ────┘            (both via the Module Internal-API)
     (contribute, from Diagram, into Core's Create Contribution)

GLSP  ──API── (use ↓ / bind ↑)
Disk  ── Source Model (UML, ER) ── (access ↓)
```

This is GLSP's concrete create-operation flow: `CreateClassHandler` (diagram-tier, element-
specific) extends a generic `BaseCreateHandler` (core-tier), so the diagram handler implements only
the UML-class-specific semantics while the generic handler does everything representation-generic.

#### 4.1.4 Flow similarity

Workflows for different source-model elements are usually identical up to the point of
modification — the user triggers an operation, GLSP-Server (or a model server) processes it, then
the source model updates. This similarity supports generic implementations (inheritance or
composition) that vary only in the modification specifics — e.g. a generic delete implemented once
in core and rebindable per element only when customization is actually needed, rather than
re-implemented per element. A hybrid of design patterns and meta-level (generic, not per-element)
operations gives the best stability/workload trade-off. §5.1.3 shows this for BIGUML.

**Limitations.** Generic/meta-level approaches can miss a unique element's specific requirements,
forcing custom solutions that break consistency; heavy inheritance can over-couple the system and
complicate change; meta-level abstraction can obscure specific element behaviour and complicate
debugging; generic operations can be less optimized for specific elements. Generic strategies need
to be balanced against tailored implementations.

### Fig. 6 — Integrated conceptual view on the reference architecture

> Caption: "Integrated conceptual view on our reference architecture (the figure shows
> illustrative examples of manifests, contributions, actions, and handlers)"

```
Diagram tier
  Manifest ──has──▶ Representation
     │ bind
     ▼
  ClassPropertyProvider, CreateClassHandler ──extends/contribute──▶ (into Tool and Core)

Tool tier
  Module  Internal-API: PropertyPaletteHandler, RequestPropertyAction
     PropertyPaletteManifest ──bind──▶ (internal classes) ──use──▶ PropertyContribution
                                                                 │ expose
                                                                 ▼
                                                        PropertyProvider ◀── contribute (from Diagram)
     ActionHandlerContribution ──expose──▶ ActionHandler ◀── use ── CoreActionHandler (contribute, from Core)

Core tier
  CreateContribution ──expose──▶ CreateHandler ◀── implement ── BaseCreateHandler
     │ use                              ▲
     ▼                                  │
  Registry ◀──use──▶ RepresentationProvider
     ▲ use                 ▲ use
  RequestCreateHandler   RequestDeleteHandler ──use──▶ GenericMetaDelete, CoreActionHandler
     (Module Internal-API, all contributed upward from their tiers)

GLSP  ──API── (use ↓ / bind ↑)
Disk  ── Source Model (UML, ER) ── (access ↓)
```

- **Source model representation services** (core tier) — detect and broadcast which representation
  is active, so other services stay context-aware via DI.
- **Delegation of GLSP requests** (core tier) — routes GLSP-platform requests to the right source
  model representation depending on which diagram/context is active.
- **Contribution points exposure** (core tier) — exposed in a representation-aware way, so
  extension/customization (and default implementations, optionally overridden per diagram) is
  possible without touching the core.
- **Meta-level operations** (core tier) — generic, cross-element operations (deletion, reconnect,
  etc.) applied consistently regardless of element or context.
- **Tool features** sit above core, implementing functionality GLSP lacks (property palette,
  outline, minimap, codegen), binding to core's contribution points, and exposing their own
  contribution points in turn for other tool/diagram features to extend.
- **Diagram modules** both (1) modify the source model (create/update/delete per user action) and
  (2) map source model elements to the graphical model GLSP needs to render them, so every source
  element has a corresponding graphical representation.

### 4.3 Application architecture

### Fig. 7 — Application architecture

> Caption: "Application architecture"

```
                         ┌───────────┐
                         │ Generator │
                         └─────┬─────┘
                               ▲
          ┌───────────────────┴────────────────────┐
          │                Host Application          │
          │        ┌────────────────────────┐        │
┌─────────┤         │     GLSP Client        │        ├─────────┐
│  LLM-   │◀────────┴────────────────────────┴───────▶│  Model- │
│Assistant│                                            │ Server  │
└─────────┘                                            └────┬────┘
          │                                                 ▲
          │               ┌───────────┐                     │
          └──────────────▶│GLSP-Server│─────────────────────┘
                           └───────────┘
   outer ring label: "Server" (top arc) / "Client" (left arc) — i.e. everything the
   Host Application talks to outward is a server-side peer (Generator, Model-Server,
   GLSP-Server), while LLM-Assistant is reached as a client-side peer.
```

A **star architecture**: the GLSP platform + host application sit at the centre, with client and
additional-service peers (Generator, Model-Server, LLM-Assistant, GLSP-Server) connected around it.
Arrows show the usual communication direction — the host application triggers the server
instances; GLSP-Client ↔ GLSP-Server is bidirectional.

1. **Client deployments.** The client is deployable into Theia, VS Code, or plain web apps. The
   authors chose VS Code for BIGUML: wide use, simple extension install, VS Code extensions also
   install into Theia without needing Theia's extra functionality, and VS Code supports
   seamless background server startup. Running everything on the user's machine is a security risk
   (tokens can't be protected) and invites environment-compatibility issues — a hybrid of
   client-on-machine + server-on-controlled-infrastructure balances security vs. dependency
   management.
2. **Client–Server Interaction.** Inside the host application, the GLSP-Client mostly talks to the
   GLSP-Server, but GLSP is a backbone, not the whole system — additional services (Sprotty,
   Langium) can be integrated alongside it.
3. **Integration of Additional Services.** E.g. an LLM-Assistant server for LLM-backed data
   processing/interaction, or code generators GLSP doesn't provide natively.
4. **Overall architecture model.** Even though each component is client–server at its own level,
   the whole system is a **star**: the GLSP platform + host sit at the centre, clients and service
   servers connect/disconnect around it, which simplifies scaling and lets services be added or
   removed per deployment without touching the centre.

## 5 Proof-of-concept: the BIGUML tool

**BIGUML** is the GLSP-based UML editor built by following §3's process and §4's architecture.
Originally a monolithic UML tool, its generic parts were later abstracted into the reference
architecture described above, leaving BIGUML to focus on UML-specific diagram behaviour. UML was
chosen deliberately as a stress test: it has multiple diagram types, the same source element must
render differently per diagram, and relationship constraints vary by diagram.

### 5.1 Realization

BIGUML used **feature-driven development**: implement one feature through the whole architecture
per iteration. After the framework was extracted, iteration focus shifted to diagram modules —
each individual diagram element in its own module (installed by the parent diagram module),
handling that element's create/delete/update operations.

#### 5.1.1 Manifest & contributions

**Table 1 — Manifests excerpt** (Manifest name / Feature / Contributions used / Description):

| Manifest name      | Feature | Contributions used (e.g.)                                                           | Description                                                                 |
| ------------------ | ------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Autocomplete       | Tool    | ActionContribution                                                                  | Exposes custom actions to the application                                   |
| Outline            | Tool    | ActionContribution                                                                  | Exposes custom actions to the application                                   |
| PropertyPalette    | Tool    | ActionContribution                                                                  | Exposes custom actions to the application                                   |
| EnumerationElement | Diagram | CreateOperationContribution, DirectEditingContribution, PropertyPaletteContribution | Defines the necessary implementations for working with enumerations         |
| AssociationElement | Diagram | CreateOperationContribution, ReconnectEdgeContribution, PropertyPaletteContribution | Defines the necessary implementations for working with associations         |
| ClassDiagram       | Diagram | ToolPaletteContribution, OutlineContribution                                        | Customizes the tool palette and outline view according to the class diagram |

**Table 2 — Contributions excerpt** (Contribution name / Provided by / Used by / Description):

| Contribution name    | Provided by | Used by      | Description                                                        |
| -------------------- | ----------- | ------------ | ------------------------------------------------------------------ |
| Action               | Core        | Tool         | Allows defining custom actions and action handlers                 |
| CreateOperation      | Core        | Diagram      | Allows the contribution of custom create operations                |
| DeleteOperation      | Core        | Diagram      | Allows the contribution of custom delete operations                |
| DiagramConfiguration | Core        | Diagram      | Allows diagram modules to configure their node / edge element      |
| DirectEditing        | Core        | Diagram      | Allows the customization of label editing                          |
| Popup                | Core        | Diagram      | Allows the customization of the hover/popup functionality          |
| ReconnectEdge        | Core        | Diagram      | Allows the customization of the behavior for reconnecting edges    |
| ToolPalette          | Core        | Diagram      | Allows diagram modules to contribute custom tool palettes          |
| Autocomplete         | Tool        | Tool/Diagram | Allows the customization of the autocomplete feature               |
| Outline              | Tool        | Diagram      | Allows the customization of the outline feature                    |
| PlantUML             | Tool        | Diagram      | Allows the customization of the import and export PlantUML feature |
| PropertyPalette      | Tool        | Diagram      | Allows the customization of the property palette feature           |

Tool features mostly consume **core** contributions (e.g. `ActionContribution`) because they
extend GLSP's base functionality. Diagram features mostly consume contributions aligned with
element creation/access/manipulation (e.g. `CreateOperationContribution`,
`PropertyPaletteContribution`), because they supply the element-specific functionality core and
tool modules need. Core contributions (`ActionContribution`, `CreateOperationContribution`) recur
across tools since they're generic; contributions like `ReconnectEdgeContribution`,
`OutlineContribution`, `PlantUMLContribution`, `PropertyPaletteContribution` vary per diagram.

### Fig. 8 — Property palette manifest & contribution example

> Caption: "Property palette manifest & contribution example"

```
Diagram tier
  ClassManifest ──bind──▶ ClassPropertyProvider ──implement──▶ (into Tool's PropertyProvider)
     contribute ▼

Tool tier
  Module Internal-API: PropertyPaletteHandler, RequestPropertyAction ◀──use── PropertyContribution
  PropertyPaletteManifest ──bind──▶ (above) ──use──▶ PropertyContribution ──expose──▶ PropertyProvider
     contribute ▼                                                                  ▲ (ClassPropertyProvider implements this)

Core tier
  Manifest ──bind──▶ CoreActionHandler ──use──▶ ActionHandlerContribution ──expose──▶ ActionHandler

Server-Framework ──API──
```

Concrete example, the **Property Palette** tool feature (a UI for editing a selected element's
properties):

- **Tool – `PropertyPaletteManifest`** — binds custom handlers for property-palette actions, using
  the core module's contribution points.
- **Tool – `Property(Palette)Contribution`** — defines the methods other modules implement to
  supply palette content.
- **Tool – `PropertyProvider`** — an interface individual diagram elements implement to declare
  which properties they show in the palette; the composed list of `PropertyProvider`s populates
  the palette.
- **Diagram – `ClassManifest`** — the class-diagram-element manifest, contributing to the property
  palette by implementing `PropertyProvider`.
- **Diagram – `ClassPropertyProvider`** — the concrete implementation listing which class-element
  properties are palette-visible.

Technically, manifests are DI containers and contributions bind functionality to target points;
the exact mechanics depend on the DI framework (GLSP's Java server uses **Google Guice**, so
BIGUML does too; BIGUML's contributions are classes that take an implementation and bind it into
Guice).

#### 5.1.2 Source model representation

The core module's session-context services detect the active diagram representation; each
contribution can hold a registry keyed by representation (see Fig. 5) for dynamic lookup.
Representation-specific diagram-module functionality (e.g. Sequence-diagram contributions) loads
only while that diagram is active; core and tool modules select the right registry entries
accordingly. GLSP itself supports client-driven dependency-module loading per active diagram, but
BIGUML instead built an on-the-fly loading mechanism that needs no client-supplied "active diagram"
information, for future-proofing and independent changeability.

#### 5.1.3 Flow similarity

For create/delete-style actions, GLSP supplies the meta-information (which elements to
create/delete) but not the handler implementation. BIGUML's create-request action handler
identifies the active representation and delegates to the right diagram module via the registries
from "Source Model Representation" (Fig. 5); the diagram-module handler then modifies the source
model, using inheritance/composition to structure operations and a custom API between the GLSP
action handler and the source-model modification code.

### Fig. 9 — BIGUML VS Code extension

> Caption: "BIGUML VS Code extension (available via:
> https://marketplace.visualstudio.com/items?itemName=BIGModelingTools.umldiagram)"

A screenshot of an opened UML Class Diagram inside the BIGUML VS Code extension — a standard IDE
tab layout (file explorer, editor, outline/property panels) with a rendered class diagram on
canvas. Not redrawn as a diagram; it documents the shipped UI, not the architecture.

### 5.2 Application

BIGUML is influenced by Eclipse Papyrus. As of v0.5.0 it supports Activity, Class, Communication,
Deployment, Information Flow, Package, Sequence, State Machine, and Use Case diagrams (some still
under development). Property Palette and Outline view are fully extracted into the reference
architecture and reusable as-is by other GLSP tools. Released on the VS Code marketplace; as of
10 December 2024, 2,600+ downloads, ~10 new downloads/day.

## The "~30 metamodel elements" rule

From §3.2 (Development phase), on when feature-oriented vs. architecture-oriented development
suits a tool:

> "Feature-oriented development is more suited for smaller teams and for less complex modeling
> tools, i.e., tools supporting small metamodels of less than ∼30 elements and offering none or
> only selected additional functionality on top of basic modeling support like CRUD operations for
> all metamodel elements. In contrast, architecture-oriented development better aligns with more
> complex modeling tools, i.e., tools supporting large metamodels and offering a lot of advanced
> features like model transformation, code generation, AI assistants, etc."

This is the threshold `#74` cites for "when to add a model server": below it, a single
feature-oriented team and an in-process store (istar-ts today) fit the paper's own recommendation;
above it, the paper's architecture-oriented approach — and by extension a separate model server —
is the better fit. The paper does not otherwise give a numeric threshold specifically for "when to
introduce a model server"; that section (6.2, "Model server") instead reports BIGUML's own
experience: they built one (over EMF.cloud), found its resource/maintenance overhead and extra
abstraction layers outweighed the separation-of-concerns benefit, and reintegrated model management
into the GLSP-Server, keeping the separation of concerns at the **code** level (packages/modules)
instead of the **application** level (a separate server process).

## Semantic vs. notation model

The paper's closest match is **source model representation separation** (§4.1.3, §4.2, §5.1.2,
Fig. 5): one **source model** (semantics) can have several **diagram representations**
(notations/views), and feature modules must always know which representation is active to apply
representation-specific constraints (detail level, read-only mode, allowed interactions). The
paper does not use the terms "semantic model" / "notation model" verbatim, but the concept —one
underlying model, several renderable views, kept explicitly distinct in the architecture—is the
same one `#74` names.

## 6 Discussion

### 6.1 Development effort

With GLSP's getting-started templates, most of a developer's effort goes into: **extending the
source model** (defining models from scratch, reusing Ecore models, or delegating to another
server — the chosen approach sets the initial cost, but extension afterwards is straightforward),
**defining the graphical model** (mapping source elements to graphical elements GLSP's client can
render — harder for elements with multiple parent–child relationships than for a plain node), and
**customizing the rendering** (SVG/CSS; GLSP ships basic labels/nodes, anything more bespoke is
manual). GLSP ships only a small set of user-facing editor features (e.g. a tool palette); new
editor features are built with GLSP's low-level client/server primitives. Notably: **no common
front-end framework (React, Lit) is used by the GLSP-Client yet** — new client UI is built in
plain/TypeScript; using a front-end framework is possible but requires upfront developer work.

The reference architecture's own overhead (defining manifests, contribution points) is offset, per
the authors, by clearly defined module interaction and independently extensible/maintainable
modules.

**Effort metrics (Java, GLSP-Server + model server):** the paper distinguishes **FLoC** (file
lines of code — everything in the file, including headers/imports/formatting boilerplate) from
**ELoC** (effective lines of code — the lines that actually need to change to add similar
functionality, e.g. a new node/edge kind).

**6.1.1 Preparations (done once).** Supporting the reference architecture's delegation needs 4
files once: (1) the class with the logic to delegate, (2) the delegated part defined as a Java
interface, (3) a contribution class gluing module manifests to the implementation, (4) optionally a
registry to categorize contributions (Fig. 6). After that, any number of feature modules reuse the
setup; adding a feature module itself needs only 2 files: the class implementing the delegated
interface, and its registration in the module's manifest.

**6.1.2 Extending the source model — Table 3** (comparing UML `Enumeration` vs. `Interface`, which
render/configure similarly; File / FLoC / ELoC):

| File                        | FLoC | ELoC  |
| --------------------------- | ---- | ----- |
| EnumerationElementManifest  | 43   | 10    |
| EnumerationConfiguration    | 49   | 4–6   |
| EnumerationOperationHandler | 49   | 6     |
| EnumerationGModelMapper     | 39   | 2     |
| GEnumerationBuilder         | 62   | 18–20 |
| InterfaceElementManifest    | 45   | 10–11 |
| InterfaceConfiguration      | 50   | 4–7   |
| InterfaceOperationHandler   | 48   | 6     |
| InterfaceGModelMapper       | 38   | 2     |
| GInterfaceBuilder           | 63   | 17–20 |

Per-file roles: `*ElementManifest` wires node creation, the `GModelMapper` choice, and property
palette display; `*Configuration` holds source-model info for GLSP; `*OperationHandler` uses the
command pattern, scoped only to node creation in the source model; `*GModelMapper` translates the
source model into GModel; `G*Builder` needs the most LoC since it dictates the element's graphical
representation — and carries the most ELoC too, since it must describe exactly how the source model
renders.

### 6.2 Lessons learned

Early BIGUML broke SoC, SRP, and source-model-representation separation, causing unexpected
behaviour and forcing a full architectural redesign; clear patterns and coding guidelines then made
extension faster and more predictable. Feedback from students in university courses and
theses — mostly developers with industrial experience — surfaced **clarity** flaws in the initial
(feature-wise stable but unclear) architecture; abstracting that feedback into the reference
architecture produced a measurable improvement in student project quality/effectiveness.

**Runtime/deployment side effects:** a Java GLSP-Server or model server pulls in a JRE dependency
(also true for the VS Code integration), which can't be assumed present on a client machine — a
preliminary-phase concern. The pure-TypeScript GLSP-Server removes this JRE requirement.

**GLSP is still actively developed:** earlier versions had bugs/instability; community (including
the authors' own student) feedback improved maturity. Recommendation: track base-framework (GLSP)
development and structure language-specific code so framework upgrades integrate cleanly — another
motivation for this architecture.

**Model server (quoted findings):** BIGUML originally ran a dedicated model server
(EMF.cloud-based, over the EMF UML metamodel) for separation of concerns — the model server alone
had write access, everything else read-only — which let the GLSP-Server focus purely on graphical
elements and tighter interaction control. Over time, "maintaining a separate model server required
substantial resources" and "introduced multiple layers of abstraction, complicating the system
architecture more than anticipated." BIGUML **reintegrated model management into the GLSP-Server**,
keeping separation of concerns at the **code** level rather than the application level — "more
manageable and resource-efficient — in the case of BIGUML it did that."

### 6.3 Critical reflection

A multi-language stack (e.g. Java server + TypeScript client) needs DevOps familiarity with both;
one language (TypeScript end-to-end) eases development/deployment. The contribution/manifest DI
system adds more overhead in Java than in TypeScript. Technology-stack decisions should balance
team experience — e.g. Java experts on the model server/GLSP-Server, TypeScript experts on the
GLSP-Client — against the cost of a split stack (vs. e.g. a pure-EMF Java-only tool). The authors'
overall judgement: GLSP's flexibility and the resulting modern, responsive, cross-platform tools
outweigh these challenges; modelers "intuitively enjoy" the GLSP UX compared to traditional
non-web metamodeling platforms.

### 6.4 Recommendations

- GLSP runs only in browsers/browser-like shells (e.g. Electron); no native platform support
  (Android, iOS, Windows) — though most platforms expose web views the client can run in (as in
  the Eclipse IDE integration). **Spend real effort on the Preliminary phase** (Fig. 2).
- GLSP scales to varying tool complexity and is used industrially, but architecture needs active
  attention as complexity grows. A model server pays off long-term but is a net drawback for tools
  that will never need additional services.
- The full reference architecture can be **overblown for tools needing only basic
  functionality** — plain GLSP may be the better fit there, and multi-diagram-type support (part
  of this architecture) may not even be needed. The extracted framework (bigGLSP-framework) still
  needs further iteration to reduce new-project setup effort.
- **Recommended for first prototypes**: GLSP's streamlined, web-based setup suits rapid
  first-concept development without a heavier framework's complexity. For more intricate tools,
  architecture planning matters, and the authors' generic framework targets exactly that gap.

### 6.5 Vision

GLSP is deliberately specialized for diagram operations and is effective within that scope. The
authors' own reference architecture started by abstracting the GLSP-**Server**; next they plan to
extend the same generalization to the **client** side, to build adaptable, broadly reusable
client-side building blocks. Their longer-term vision goes beyond diagram editors toward a broader
modeling-tool reference architecture covering code generation, versioning, model validation, and
**hybrid (textual + graphical) editing** — GLSP itself has no built-in hybrid-editing support, but
its flexible design allows one to be built on top (developers build the UI/API and wire edits
across representations themselves). They also want a **standard API** for installable/removable
additional services on client and server (e.g. visual diffs), functioning like an extension
system, so users add capability by installing packages rather than modifying existing code.

### 6.6 Limitations

The authors state their own limitations, framed against the validity taxonomy in Wohlin et al.,
_Experimentation in Software Engineering_ (reference [55]):

- **Generalizability** — fewer than 10 GLSP-based tools built so far; extensive supervised-student
  experience exists, but lessons learned can't be generalized to other developers or other
  modeling languages without reservation.
- **Selection bias** — UML was chosen as a complex, well-known language, but every modeling
  language has its own particularities; further instantiations of GLSP and the reference framework
  are needed to mitigate this bias. The authors hope the public release [22] (bigGLSP-framework)
  invites community adoption and feedback that improves the architecture.
- **Researcher involvement** — the authors supervised the students, designed the architecture, and
  built the reference implementation themselves. They consider this partly mitigated by close
  collaboration with **EclipseSource**, who validated the results' usefulness, and note that ideas
  from this work have already been integrated into the general GLSP repository.

## 7 Conclusion

The paper's close: modeling-tool development remains a live research area and a recognized
scientific contribution; GLSP and web technologies open new avenues for flexible, usable,
web-based modeling tools, but building them is still hard. The paper's contribution is a
development-and-operation process, a set of architectural principles, and a reference architecture
for GLSP-based web modeling tools, proven via **BIGUML**, a GLSP-based UML editor released as a VS
Code extension. Its stated intended audience is researchers and engineers building web modeling
tools; the critical reflection and lessons learned are meant to inform the decision of whether to
adopt GLSP. The reference implementation is public:
[github.com/glsp-extensions/bigGLSP-framework](https://github.com/glsp-extensions/bigGLSP-framework)
(Zenodo [10.5281/zenodo.14316697](https://doi.org/10.5281/zenodo.14316697)). The authors hope to
see a community repository of GLSP tools emerge, so the ecosystem can share generic solutions
across tool projects rather than reinventing them.

## bigUML and bigGLSP specifics named in the paper

- **BIGUML** — the GLSP-based UML editor proof-of-concept. Released as a VS Code marketplace
  extension: `https://marketplace.visualstudio.com/items?itemName=BIGModelingTools.umldiagram`.
  Reference: Metin, H., Weiß, J., Bork, D.: `borkdominik/bigUML: SoSyM 24` (2024),
  [10.5281/zenodo.14316667](https://doi.org/10.5281/zenodo.14316667).
- **bigGLSP-framework** — the extracted, reusable GLSP-Server extension framework that embodies
  this paper's patterns (SoC/SSoT/SRP, manifests, contributions, core/tool/diagram modules).
  Repository: [github.com/glsp-extensions/bigGLSP-framework](https://github.com/glsp-extensions/bigGLSP-framework).
  Reference: Metin, H.: `glsp-extensions/bigGLSP-framework: SoSyM 24` (2024),
  [10.5281/zenodo.14316697](https://doi.org/10.5281/zenodo.14316697).
- Module names used by example (BIGUML's Property Palette, §5.1.1 / Fig. 8): `PropertyPaletteManifest`,
  `Property(Palette)Contribution`, `PropertyProvider`, `ClassManifest`, `ClassPropertyProvider`.
- Dependency injection: **Google Guice** (`github.com/google/guice`) for the Java GLSP-Server (and
  so for BIGUML); **InversifyJS** (`github.com/inversify/InversifyJS`) named as the TypeScript-side
  DI option for the architecture generally.
- Model server used in BIGUML's earlier (later reverted) architecture: the **EMF.cloud model
  server** (`github.com/eclipse-emfcloud/emfcloud-modelserver`).
- GLSP gallery of example tools: `https://www.eclipse.org/glsp/gallery/`.

## Mapping to istar-ts

`#74`'s starting table, with paper section references added. ❓ marks anything this transcription
leaves uncertain for the epic's open decisions to resolve.

| Paper concept (§)                                                                                                            | istar-ts today                                                                                                                                                                                | After `#74`                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GLSP server, operation handlers, source model, undo/redo (§2, §4.1.1 core tier)                                              | `@istar-ts/actions` dispatcher over `ModelStore` (see `docs/action-protocol.md`)                                                                                                              | same dispatcher, behind a GLSP server adapter (`@istar-ts/glsp`, S1)                                                                                                                                                                                                                                                    |
| GLSP protocol / `ActionMessage`, lifecycle methods (§2)                                                                      | one method per action kind (`#40`)                                                                                                                                                            | GLSP's five lifecycle methods (`#44`, S0)                                                                                                                                                                                                                                                                               |
| GModel, `setModel`/`updateModel` push (§2, Fig. 1, §4.1.1)                                                                   | the client derives its own graph (`modelToFlow`); `setModel` carries piStar JSON, not a GModel                                                                                                | `modelToGModel` (S1) plus an `updateModel` push after every accepted operation, per Core tier's "Delegation of GLSP requests" (§4.2)                                                                                                                                                                                    |
| Feature tiers: **core / tool / diagram** (§4.1.1, Fig. 3)                                                                    | core (`@istar-ts/core`: metamodel, operations) → react (`@istar-ts/react`: canvas, inspector, palette) → `IstarExtension`s (dialect shapes/inspectors, `examples/playground/src/extensions/`) | name the tiers explicitly in the adapter; each `IstarExtension` becomes a **diagram**-tier contribution (palette, type hints, GModel types/views) consumed by a shared **core**-tier adapter, mirroring Fig. 3's core/tool/diagram split                                                                                |
| Manifests & contributions (§4.1.2, Fig. 4, Fig. 6, Fig. 8, §5.1.1)                                                           | no DI container; extensions are plain objects passed into `createRegistry`/`IstarCanvas`                                                                                                      | ✅ decided in `#80`: `@istar-ts/glsp` uses the GLSP server's own Inversify container, confined to that package. A dialect's data is an `IstarGlspContribution`, bound by its manifest (`IstarContributionModule`) next to the core tier's `IstarDiagramModule` (`configureIstarDiagram`); see `packages/glsp/README.md` |
| Source model representation separation (§4.1.3, §4.2, §5.1.2, Fig. 5) — closest paper match to "semantic vs. notation model" | one piStar file holds both; the canvas derives its own view                                                                                                                                   | unchanged: the adapter derives GModel notation from the one semantic file; `#74` documents this as a deliberate, declared difference from the paper's separate-representation model                                                                                                                                     |
| Flow similarity / generic + element-specific handlers (§4.1.4, Fig. 5)                                                       | `ModelStore` operations are already generic across kinds (`createNode`, `deleteElement`, …); kind-specific behaviour lives in the metamodel's `rules`/`canLink`, not per-kind handler classes | likely unchanged — istar-ts's operation layer is already closer to the paper's "generic meta-level operation" end of the spectrum than to per-kind handlers                                                                                                                                                             |
| Client–server split, protocol transport (§2, §4.3, Fig. 7)                                                                   | in-process only; no transport                                                                                                                                                                 | a Node WebSocket host around `createActionDispatcher` (S1), optionally a Worker variant                                                                                                                                                                                                                                 |
| Model server, "~30 elements" rule (§3.2, §6.2)                                                                               | in-memory `ModelStore`, `parsePistar`/`toPistar`                                                                                                                                              | unchanged: iStar 2.0 is under the paper's ~30-element feature-oriented threshold; `dsm3-kaos` + obstacles is close — revisit if it crosses that line, same conclusion the paper reaches for BIGUML itself (§6.2, model server reintegrated into the server rather than kept separate)                                   |
| Client framework, rendering (§2, §6.1)                                                                                       | React Flow (`@xyflow/react`), one stylesheet, CSS-variable themed                                                                                                                             | React Flow stays primary; add a stock `@eclipse-glsp/client` (`examples/glsp-client`, S2) — the paper itself notes the GLSP-Client doesn't use a front-end framework like React (§6.1), so istar-ts's React client is not what the stock client will use                                                                |
| Palette / tool palette (§4.1.2 Table 2, §5.1.1 Table 1)                                                                      | `PaletteDescription` (`@istar-ts/core`), react registry entries derived from it                                                                                                               | `requestContextActions`/`setContextActions` (`ToolPaletteContribution` equivalent), per `docs/action-protocol.md`'s existing GLSP-concept table                                                                                                                                                                         |
| Markers (§2 built-in functionality)                                                                                          | `GoalDiagnostic`, `DiagnosticsStore`                                                                                                                                                          | `requestMarkers`/`setMarkers`/`deleteMarkers`, already named in `docs/action-protocol.md`                                                                                                                                                                                                                               |
| e2e testing (§3.2.4)                                                                                                         | Playwright on the playground (`#48`)                                                                                                                                                          | `@eclipse-glsp/playwright` page objects for the stock client (S4), same lessons as the playground's e2e                                                                                                                                                                                                                 |
| DI framework (§4.1.2 Limitations, §6.3)                                                                                      | none                                                                                                                                                                                          | ✅ decided in `#80`: Inversify, through `@eclipse-glsp/server` (its peer), only in `@istar-ts/glsp`; legacy decorators with an explicit `@inject()` per constructor parameter, built by tsdown. Core, actions, react and the dialect packages stay DI-free                                                              |
