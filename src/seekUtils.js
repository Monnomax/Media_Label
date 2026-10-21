export function calculateSeekPosition(currentPosition, offsetUs, length) {
    const upperBound = length > 0 ? length : Number.MAX_SAFE_INTEGER;
    return Math.max(0, Math.min((currentPosition || 0) + offsetUs, upperBound));
}
