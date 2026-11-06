- **core:** an actor's saved box (`x`/`y`, and `display.width`/`height` when stored) now encloses
  its children after any content change, kept in sync by the model operations rather than
  derived at save time — so it stays stable across a serialize/parse round trip (mirror stores,
  reopened files), and moving a child out and back restores it exactly.
- **core:** new optional `display[actor].anchor` key, written only while a child lies left of/
  above the actor's own position, holding the position the user gave the actor. piStar ignores
  it; files without that state are unchanged.
