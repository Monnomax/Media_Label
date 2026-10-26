// Pure geometry helper: decides which viewport edges hide part of a long title.
export function getTextFadeState(
    translationX,
    textWidth,
    containerWidth,
    epsilon = 0.5,
) {
    const offset = Number.isFinite(Number(translationX))
        ? Number(translationX)
        : 0;
    const naturalWidth = Number(textWidth);
    const visibleWidth = Number(containerWidth);
    const threshold = Math.max(0, Number(epsilon) || 0);

    if (
        !Number.isFinite(naturalWidth) ||
        !Number.isFinite(visibleWidth) ||
        visibleWidth <= 0
    ) {
        return { left: false, right: false };
    }

    const overflow = naturalWidth - visibleWidth;
    if (overflow <= threshold) return { left: false, right: false };

    return {
        left: offset < -threshold,
        right: offset > -overflow + threshold,
    };
}
