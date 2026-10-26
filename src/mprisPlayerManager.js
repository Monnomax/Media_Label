import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";
import { matchesFocusedApplication } from "./focusedPlayerMatcher.js";
import { MPRIS_INTERFACE, DBUS_INTERFACE } from "./dbusInterfaces.js";

export class MprisPlayerManager {
    constructor(settings, delegate) {
        this._settings = settings;
        this._delegate = delegate;
        this._isDestroyed = false;
        this._players = new Map();
        this._nameOwnerChangedSignalId = null;
        this._focusedPlayerAddress = null;
        this._focusSyncIdleId = null;

        this._windowTracker = Shell.WindowTracker.get_default();
        this._focusAppChangedSignalId = this._windowTracker.connect(
            "notify::focus-app",
            () => this._scheduleFocusSync(),
        );

        this._initDBus();
    }

    _initDBus() {
        const dBusProxyWrapper = Gio.DBusProxy.makeProxyWrapper(DBUS_INTERFACE);

        this.dBusProxy = dBusProxyWrapper(
            Gio.DBus.session,
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            () => {
                let [names] = this.dBusProxy.ListNamesSync();
                for (const name of names) {
                    if (name.startsWith("org.mpris.MediaPlayer2"))
                        this._addPlayer(name);
                }
            },
        );

        this._nameOwnerChangedSignalId = this.dBusProxy.connectSignal(
            "NameOwnerChanged",
            (proxy, sender, [name, oldOwner, newOwner]) => {
                if (!name.startsWith("org.mpris.MediaPlayer2")) return;

                if (newOwner && !this._players.has(name)) this._addPlayer(name);
                else if (!newOwner && this._players.has(name))
                    this._removePlayer(name);
            },
        );
    }

    _addPlayer(address) {
        if (this._isDestroyed || this._players.has(address)) return;

        const proxyWrapper = Gio.DBusProxy.makeProxyWrapper(MPRIS_INTERFACE);
        const entry = {
            proxy: null,
            propId: null,
            identity: "",
            lastActive: GLib.get_monotonic_time(),
        };
        this._players.set(address, entry);

        entry.proxy = proxyWrapper(
            Gio.DBus.session,
            address,
            "/org/mpris/MediaPlayer2",
            async () => {
                if (this._isDestroyed || !this._players.has(address)) return;
                await this._registerPlayerInFilters(address);

                entry.lastActive = GLib.get_monotonic_time();

                // Prefer the player belonging to the focused application,
                // regardless of which player most recently emitted a change.
                this._focusedPlayerAddress = this._findFocusedPlayerAddress();
                if (this._focusedPlayerAddress) {
                    if (this._focusedPlayerAddress === address)
                        this._activate(address);
                    else this._delegate.refreshVisibility();
                    return;
                }

                const activeAddress = this._delegate.getActiveAddress();
                if (!activeAddress || entry.proxy.PlaybackStatus === "Playing")
                    this._activate(address);
                else this._delegate.refreshVisibility();
            },
        );

        entry.propId = entry.proxy.connect("g-properties-changed", () => {
            entry.lastActive = GLib.get_monotonic_time();

            if (this._focusedPlayerAddress) {
                if (this._focusedPlayerAddress === address)
                    this._activate(address);
                else this._delegate.refreshVisibility();
                return;
            }

            this._activate(address);
        });
    }

    _removePlayer(address) {
        const entry = this._players.get(address);
        if (!entry) return;

        if (entry.propId && entry.proxy) entry.proxy.disconnect(entry.propId);
        this._players.delete(address);

        const wasActive = this._delegate.getActiveAddress() === address;
        this._focusedPlayerAddress = this._findFocusedPlayerAddress();

        if (this._focusedPlayerAddress) {
            if (this._delegate.getActiveAddress() !== this._focusedPlayerAddress)
                this._activate(this._focusedPlayerAddress);
            return;
        }
        if (!wasActive) return;

        const next = this._pickNextActivePlayer();
        if (next) this._activate(next);
        else this._delegate.clearActivePlayer();
    }

    _scheduleFocusSync() {
        if (this._isDestroyed || this._focusSyncIdleId) return;

        // Coalesce transient focus-app changes emitted during one focus switch.
        this._focusSyncIdleId = GLib.idle_add(
            GLib.PRIORITY_DEFAULT_IDLE,
            () => {
                this._focusSyncIdleId = null;
                if (!this._isDestroyed) this._syncFocusedPlayer();
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    _findFocusedPlayerAddress() {
        const focusedAppId = this._windowTracker?.focus_app?.id;
        if (!focusedAppId) return null;

        let playingCandidate = null;
        let playingTime = -1;
        let anyCandidate = null;
        let anyTime = -1;

        for (const [address, entry] of this._players) {
            if (
                !entry.proxy ||
                !matchesFocusedApplication(
                    focusedAppId,
                    address,
                    entry.identity,
                )
            )
                continue;

            if (entry.lastActive > anyTime) {
                anyTime = entry.lastActive;
                anyCandidate = address;
            }

            if (
                entry.proxy.PlaybackStatus === "Playing" &&
                entry.lastActive > playingTime
            ) {
                playingTime = entry.lastActive;
                playingCandidate = address;
            }
        }

        return playingCandidate || anyCandidate;
    }

    _syncFocusedPlayer() {
        if (this._isDestroyed) return;

        const previousFocusedAddress = this._focusedPlayerAddress;
        this._focusedPlayerAddress = this._findFocusedPlayerAddress();

        if (this._focusedPlayerAddress) {
            if (
                this._delegate.getActiveAddress() !==
                this._focusedPlayerAddress
            )
                this._activate(this._focusedPlayerAddress);
            return;
        }

        // If focus moved to a non-player window, return to the normal MPRIS
        // selection policy rather than leaving a stale focus lock in place.
        if (previousFocusedAddress) {
            const next = this._pickNextActivePlayer();
            if (next) this._activate(next);
            else if (this._delegate.getActiveAddress())
                this._delegate.clearActivePlayer();
        }
    }

    _pickNextActivePlayer() {
        let playingCandidate = null,
            playingTime = -1;
        let anyCandidate = null,
            anyTime = -1;

        for (const [address, entry] of this._players) {
            if (!entry.proxy) continue;

            if (entry.lastActive > anyTime) {
                anyTime = entry.lastActive;
                anyCandidate = address;
            }

            if (
                entry.proxy.PlaybackStatus === "Playing" &&
                entry.lastActive > playingTime
            ) {
                playingTime = entry.lastActive;
                playingCandidate = address;
            }
        }

        return playingCandidate || anyCandidate;
    }

    _activate(address) {
        const entry = this._players.get(address);
        if (!entry || !entry.proxy) return;
        this._delegate.activatePlayer(address, entry.proxy);
    }

    getAppIdentifier(address) {
        if (!address) return null;
        let id = address.replace(/^org\.mpris\.MediaPlayer2\./, "");
        return id.split(".instance")[0];
    }

    async _registerPlayerInFilters(address) {
        const appId = this.getAppIdentifier(address);
        if (!appId) return;

        try {
            let identity = "Unknown Player";
            const connection = Gio.DBus.session;

            const result = await connection.call(
                address,
                "/org/mpris/MediaPlayer2",
                "org.freedesktop.DBus.Properties",
                "Get",
                new GLib.Variant("(ss)", [
                    "org.mpris.MediaPlayer2",
                    "Identity",
                ]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
            );

            if (result) {
                let [variant] = result.recursiveUnpack();
                identity = variant;
            }

            const entry = this._players.get(address);
            if (entry) entry.identity = String(identity ?? "");

            let players = JSON.parse(
                this._settings.get_string("media-players"),
            );

            if (!players[appId]) {
                players[appId] = { name: identity, visible: true };
                this._settings.set_string(
                    "media-players",
                    JSON.stringify(players),
                );
            }
        } catch (e) {
            log(`Error registering player: ${e.message}`);
        }
    }

    call(address, method) {
        if (!address) return;

        Gio.DBus.session.call(
            address,
            "/org/mpris/MediaPlayer2",
            "org.mpris.MediaPlayer2.Player",
            method,
            null,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            null,
        );
    }

    seek(address, offsetUs) {
        if (!address) return;

        Gio.DBus.session.call(
            address,
            "/org/mpris/MediaPlayer2",
            "org.mpris.MediaPlayer2.Player",
            "Seek",
            new GLib.Variant("(x)", [offsetUs]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            null,
        );
    }

    async getPosition(address) {
        if (!address) return null;

        try {
            const result = await Gio.DBus.session.call(
                address,
                "/org/mpris/MediaPlayer2",
                "org.freedesktop.DBus.Properties",
                "Get",
                new GLib.Variant("(ss)", [
                    "org.mpris.MediaPlayer2.Player",
                    "Position",
                ]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
            );

            if (!result) return null;
            const [variant] = result.recursiveUnpack();
            return Number(variant) || 0;
        } catch (e) {
            return null;
        }
    }

    destroy() {
        if (this._isDestroyed) return;
        this._isDestroyed = true;

        if (this._focusSyncIdleId) {
            GLib.source_remove(this._focusSyncIdleId);
            this._focusSyncIdleId = null;
        }

        if (this._windowTracker && this._focusAppChangedSignalId) {
            this._windowTracker.disconnect(this._focusAppChangedSignalId);
            this._focusAppChangedSignalId = null;
        }
        this._windowTracker = null;
        this._focusedPlayerAddress = null;

        if (this.dBusProxy && this._nameOwnerChangedSignalId) {
            this.dBusProxy.disconnectSignal(this._nameOwnerChangedSignalId);
            this._nameOwnerChangedSignalId = null;
        }

        for (const [, entry] of this._players) {
            if (entry.propId && entry.proxy)
                entry.proxy.disconnect(entry.propId);
        }
        this._players.clear();
        this.dBusProxy = null;
    }
}
