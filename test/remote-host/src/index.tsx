// Module Federation needs an async boundary before the first shared import (React), so the app loads from its own chunk.
void import("./bootstrap");
