export function calculatePanelProgressGeometry({
    width,
    height,
    layoutX,
    artVisible,
    artWidth,
    artX,
}) {
    const buttonWidth = Math.max(0, Math.round(width));
    const buttonHeight = Math.max(0, Math.round(height));
    if (buttonWidth <= 0 || buttonHeight <= 0) return null;

    const hasVisibleArt = Boolean(artVisible);
    const coverWidth = hasVisibleArt
        ? Math.min(buttonWidth, Math.round(artWidth))
        : 0;
    const coverX = hasVisibleArt ? Math.max(0, Math.round(layoutX + artX)) : 0;
    const trackX = Math.min(buttonWidth, coverX + coverWidth);
    const trackWidth = Math.max(0, buttonWidth - trackX);
    const underlapWidth = hasVisibleArt ? Math.round(coverWidth / 2) : 0;

    return {
        height: buttonHeight,
        trackX,
        trackWidth,
        underlapWidth,
    };
}

export function calculatePanelProgressFillWidth(
    position,
    duration,
    trackWidth,
    underlapWidth,
) {
    const safeDuration = Math.max(0, Number(duration) || 0);
    const safePosition = Math.max(0, Number(position) || 0);
    const ratio =
        safeDuration > 0
            ? Math.max(0, Math.min(1, safePosition / safeDuration))
            : 0;

    return Math.min(
        underlapWidth + trackWidth,
        Math.round(underlapWidth + trackWidth * ratio),
    );
}

export function paintPanelProgress(
    area,
    { Cairo, geometry, position, duration, radius, settings },
) {
    const cr = area.get_context();
    try {
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        if (!geometry) return;

        const height = Math.max(0, Math.round(area.height));
        if (height <= 0) return;

        const { trackX, trackWidth, underlapWidth } = geometry;
        const fillWidth = calculatePanelProgressFillWidth(
            position,
            duration,
            trackWidth,
            underlapWidth,
        );

        if (fillWidth > 0) {
            const x = trackX - underlapWidth;
            const y = 0;
            const w = fillWidth;
            const h = height;
            const buttonRadius = Math.max(
                0,
                Number(radius ?? settings?.get_int("album-radius") ?? 0) || 0,
            );
            const cornerRadius = Math.min(buttonRadius, w / 2, h / 2);

            cr.newSubPath();
            if (cornerRadius <= 0) {
                cr.rectangle(x, y, w, h);
            } else {
                cr.arc(
                    x + w - cornerRadius,
                    y + cornerRadius,
                    cornerRadius,
                    -Math.PI / 2,
                    0,
                );
                cr.arc(
                    x + w - cornerRadius,
                    y + h - cornerRadius,
                    cornerRadius,
                    0,
                    Math.PI / 2,
                );
                cr.arc(
                    x + cornerRadius,
                    y + h - cornerRadius,
                    cornerRadius,
                    Math.PI / 2,
                    Math.PI,
                );
                cr.arc(
                    x + cornerRadius,
                    y + cornerRadius,
                    cornerRadius,
                    Math.PI,
                    Math.PI * 1.5,
                );
                cr.closePath();
            }

            cr.setSourceRGBA(1, 1, 1, 0.1);
            cr.fill();
        }
    } finally {
        cr.$dispose();
    }
}

export function updatePanelProgressGeometry(indicator) {
    if (
        indicator._isDestroyed ||
        !indicator._progressLayer ||
        !indicator.layout
    )
        return;

    const geometry = calculatePanelProgressGeometry({
        width: indicator.width,
        height: indicator.height,
        layoutX: indicator.layout.x,
        artVisible: Boolean(
            indicator.albumArt &&
            indicator.albumArt.visible &&
            indicator.albumArt.width > 0,
        ),
        artWidth: indicator.albumArt?.width,
        artX: indicator.albumArt?.x,
    });

    if (!geometry) {
        indicator._panelProgressGeometry = null;
        indicator._progressLayer.queue_repaint();
        return;
    }

    indicator._panelProgressGeometry = geometry;
    indicator._progressLayer.queue_repaint();
}
