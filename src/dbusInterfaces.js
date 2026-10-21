export const MPRIS_INTERFACE = `<node><interface name="org.mpris.MediaPlayer2.Player">
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="PlaybackStatus" type="s" access="read"/>
</interface></node>`;

export const DBUS_INTERFACE = `<node><interface name="org.freedesktop.DBus">
    <method name="ListNames"><arg direction="out" type="as"/></method>
    <signal name="NameOwnerChanged"><arg direction="out" type="s"/><arg direction="out" type="s"/><arg direction="out" type="s"/></signal>
</interface></node>`;
