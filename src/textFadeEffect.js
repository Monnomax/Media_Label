import Cogl from "gi://Cogl";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Shell from "gi://Shell";

const FADE_DURATION_US = 200_000;
const FRAME_INTERVAL_MS = 16;
const DEFAULT_FADE_WIDTH_PX = 24;

const DECLARATIONS = `
uniform float left_fade;
uniform float right_fade;
uniform float fade_width;
`;

const CODE = `
vec2 uv = cogl_tex_coord0_in.xy;
float fade = 1.0;

if (fade_width > 0.00001) {
    float left_mask = smoothstep(0.0, fade_width, uv.x);
    fade = mix(1.0, left_mask, left_fade);

    float right_mask = smoothstep(0.0, fade_width, 1.0 - uv.x);
    fade = min(fade, mix(1.0, right_mask, right_fade));
}

/* Cogl uses premultiplied alpha: fade the complete output color. */
cogl_color_out *= fade;
`;

export const TextFadeEffect = GObject.registerClass(
    { GTypeName: "MediaLabelTextFadeEffect" },
    class TextFadeEffect extends Shell.GLSLEffect {
        _u = null;
        _leftFade = 0;
        _rightFade = 0;
        _targetLeft = null;
        _targetRight = null;
        _fadeWidth = null;
        _animationId = 0;

        vfunc_build_pipeline() {
            const hook =
                Shell.SnippetHook?.FRAGMENT ?? Cogl.SnippetHook.FRAGMENT;
            this.add_glsl_snippet(hook, DECLARATIONS, CODE, false);
        }

        _ensureUniforms() {
            if (this._u) return true;

            try {
                this._u = {
                    left: this.get_uniform_location("left_fade"),
                    right: this.get_uniform_location("right_fade"),
                    width: this.get_uniform_location("fade_width"),
                };
                return true;
            } catch (e) {
                console.warn(
                    `Media Label: failed to initialize text fade shader: ${e.message}`,
                );
                this._u = null;
                return false;
            }
        }

        setFade(leftEnabled, rightEnabled, fadeWidthPx = DEFAULT_FADE_WIDTH_PX) {
            const actorWidth = this.actor?.get_width?.() ?? 0;
            const normalizedWidth =
                actorWidth > 0
                    ? Math.min(0.5, Math.max(0, fadeWidthPx / actorWidth))
                    : 0;

            const left = !!leftEnabled;
            const right = !!rightEnabled;

            if (!this._ensureUniforms()) return;

            const widthChanged = normalizedWidth !== this._fadeWidth;
            if (widthChanged) {
                this._fadeWidth = normalizedWidth;
                this.set_uniform_float(this._u.width, 1, [normalizedWidth]);
            }

            if (left === this._targetLeft && right === this._targetRight) {
                this.set_enabled(
                    normalizedWidth > 0 &&
                        (left ||
                            right ||
                            this._leftFade > 0 ||
                            this._rightFade > 0),
                );
                if (widthChanged) this.queue_repaint();
                return;
            }

            this._targetLeft = left;
            this._targetRight = right;
            this._startFadeTransition(normalizedWidth);
        }

        _startFadeTransition(normalizedWidth) {
            if (this._animationId) {
                GLib.source_remove(this._animationId);
                this._animationId = 0;
            }

            const targetLeft = this._targetLeft ? 1 : 0;
            const targetRight = this._targetRight ? 1 : 0;
            const fromLeft = this._leftFade;
            const fromRight = this._rightFade;
            const startedAt = GLib.get_monotonic_time();

            if (!targetLeft && !targetRight && !fromLeft && !fromRight) {
                this.set_uniform_float(this._u.left, 1, [0]);
                this.set_uniform_float(this._u.right, 1, [0]);
                this.set_enabled(false);
                this.queue_repaint();
                return;
            }

            if (normalizedWidth <= 0) {
                this._leftFade = targetLeft;
                this._rightFade = targetRight;
                this.set_uniform_float(this._u.left, 1, [targetLeft]);
                this.set_uniform_float(this._u.right, 1, [targetRight]);
                this.set_enabled(false);
                this.queue_repaint();
                return;
            }

            this.set_enabled(
                targetLeft > 0 ||
                    targetRight > 0 ||
                    fromLeft > 0 ||
                    fromRight > 0,
            );

            this._animationId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                FRAME_INTERVAL_MS,
                () => {
                    const progress = Math.min(
                        1,
                        (GLib.get_monotonic_time() - startedAt) /
                            FADE_DURATION_US,
                    );
                    const easedProgress =
                        progress * progress * (3 - 2 * progress);

                    this._leftFade =
                        fromLeft + (targetLeft - fromLeft) * easedProgress;
                    this._rightFade =
                        fromRight + (targetRight - fromRight) * easedProgress;

                    this.set_uniform_float(this._u.left, 1, [this._leftFade]);
                    this.set_uniform_float(this._u.right, 1, [this._rightFade]);
                    this.queue_repaint();

                    if (progress < 1) return GLib.SOURCE_CONTINUE;

                    this._animationId = 0;
                    if (!targetLeft && !targetRight) this.set_enabled(false);
                    return GLib.SOURCE_REMOVE;
                },
            );
        }

        stopAnimation() {
            if (this._animationId) {
                GLib.source_remove(this._animationId);
                this._animationId = 0;
            }
            this.set_enabled(false);
            this.queue_repaint();
        }
    },
);
