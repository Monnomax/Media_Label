import Soup from "gi://Soup?version=3.0";
import GLib from "gi://GLib";

const session = new Soup.Session();

export async function fetchLyrics(artist, title) {
    if (!artist || !title) return null;

    return new Promise((resolve) => {
        try {
            // Беремо лише першого виконавця, якщо їх декілька, для більшої точності пошуку
            const queryArtist = encodeURIComponent(artist.split(",")[0].trim());
            const queryTitle = encodeURIComponent(title.trim());

            // Формуємо URL для lrclib.net
            const url = `https://lrclib.net/api/get?artist_name=${queryArtist}&track_name=${queryTitle}`;

            const message = Soup.Message.new("GET", url);

            // LRCLIB просить передавати User-Agent для ідентифікації застосунків
            message
                .get_request_headers()
                .append("User-Agent", "GNOME-Shell-Media-Label-Extension");

            session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, res) => {
                    try {
                        const bytes = session.send_and_read_finish(res);

                        if (message.get_status() === 200) {
                            const decoder = new TextDecoder("utf-8");
                            const text = decoder.decode(bytes.get_data());
                            const json = JSON.parse(text);

                            // LRCLIB повертає текст у plainLyrics. Якщо його немає, беремо syncedLyrics.
                            if (json && json.plainLyrics) {
                                resolve(json.plainLyrics.trim());
                            } else if (json && json.syncedLyrics) {
                                resolve(json.syncedLyrics.trim());
                            } else {
                                resolve(null);
                            }
                        } else {
                            // Трек не знайдено або помилка сервера (наприклад, 404)
                            resolve(null);
                        }
                    } catch (e) {
                        console.error(`Lyrics parse error: ${e.message}`);
                        resolve(null);
                    }
                },
            );
        } catch (e) {
            console.error(`Lyrics fetch exception: ${e.message}`);
            resolve(null);
        }
    });
}
