/**
 * The courier's size. She is drawn short and stubby, as the reference's own character is (figure.ts COURIER_LOOK and
 * FigureLook.stature): about 1.5 m tall against a 6-unit (2.8 m) storey.
 *
 * The reference's camera framing and pace were measured in its character's heights (look-analysis.md: the camera 3.39
 * heights from it, a jog of 2.11 heights a second) and first fitted to a 3.79-tall figure. COURIER_SIZE carries those
 * fits to her height, so she fills the view as the reference's character does and keeps its pace and rhythm.
 * models.test.ts checks this against the built figure.
 */
export const COURIER_HEIGHT = 3.2356;
/** The figure height the camera and pace were first fitted to. */
export const FITTED_HEIGHT = 3.79;
export const COURIER_SIZE = COURIER_HEIGHT / FITTED_HEIGHT;
