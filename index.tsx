
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, makeRange } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { GuildChannelStore, Menu, RestAPI, UserStore, Toasts, React } from "@webpack/common";
import type { Channel } from "discord-types/general";

const VoiceStateStore = findStoreLazy("VoiceStateStore");

export const settings = definePluginSettings({
    waitAfter: {
        type: OptionType.SLIDER,
        description: "Rate limit önlemek için beklemeden önce yapılacak işlem sayısı",
        default: 5,
        markers: makeRange(1, 20),
        restartNeeded: false,
    },
    waitSeconds: {
        type: OptionType.SLIDER,
        description: "Her grup arasında bekleme süresi (saniye)",
        default: 1,
        markers: makeRange(0.5, 5, 0.5),
        restartNeeded: false,
    }
});

async function runSequential<T>(promises: Promise<T>[]): Promise<T[]> {
    const results: T[] = [];
    const batchSize = Math.max(1, settings.store.waitAfter);
    const waitTime = settings.store.waitSeconds * 1000;

    for (let i = 0; i < promises.length; i++) {
        const promise = promises[i];

        try {
            const result = await promise;
            results.push(result);
        } catch (e) {
            console.error("SesTopluKontrol: İşlem başarısız", e);
        }

        if ((i + 1) % batchSize === 0 && i !== promises.length - 1) {
            Toasts.show({ message: `Rate limit için ${settings.store.waitSeconds}s bekleniyor...`, type: Toasts.Type.INFO });
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    return results;
}

function sendPatch(channel: Channel, body: Record<string, any>, bypass = false, label = "İşlem") {
    const usersVoice = VoiceStateStore.getVoiceStatesForChannel(channel.id);
    const myId = UserStore.getCurrentUser().id;

    if (!usersVoice || Object.keys(usersVoice).length === 0) {
        Toasts.show({ message: "Kanalda kullanıcı bulunamadı.", type: Toasts.Type.FAILURE });
        return;
    }

    const promises: Promise<any>[] = [];
    let userCount = 0;

    Object.values(usersVoice).forEach((userVoice: any) => {
        if (bypass || userVoice.userId !== myId) {
            promises.push(RestAPI.patch({
                url: `/guilds/${channel.guild_id}/members/${userVoice.userId}`,
                body: body
            }));
            userCount++;
        }
    });

    if (userCount === 0) {
        Toasts.show({ message: "Hedeflenecek kullanıcı yok.", type: Toasts.Type.WARNING });
        return;
    }

    Toasts.show({ message: `Başlatılıyor: ${label} (${userCount} kullanıcı)...`, type: Toasts.Type.INFO });

    runSequential(promises).then(() => {
        Toasts.show({ message: `Tamamlandı: ${label}`, type: Toasts.Type.SUCCESS });
    }).catch(error => {
        console.error("SesTopluKontrol çalıştırılamadı", error);
        Toasts.show({ message: `Hata: ${label} başarısız. Konsolu kontrol edin.`, type: Toasts.Type.FAILURE });
    });
}

const Actions = {
    disconnect: (channel: Channel) => sendPatch(channel, { channel_id: null }, false, "Hepsini Bağlantıdan Çıkar"),
    mute: (channel: Channel, mute: boolean) => sendPatch(channel, { mute }, false, mute ? "Hepsini Sustur" : "Hepsinin Susturmasını Kaldır"),
    deafen: (channel: Channel, deaf: boolean) => sendPatch(channel, { deaf }, false, deaf ? "Hepsini Sağırlaştır" : "Hepsinin Sağırlaştırmasını Kaldır"),
    move: (channel: Channel, targetChannelId: string) => sendPatch(channel, { channel_id: targetChannelId }, true, "Hepsini Taşı")
};

interface VoiceChannelContextProps {
    channel: Channel;
}

const VoiceChannelContext: NavContextMenuPatchCallback = (children, { channel }: VoiceChannelContextProps) => {
    if (!channel || (channel.type !== 2 && channel.type !== 13)) return;

    const guildChannels = GuildChannelStore.getChannels(channel.guild_id);

    let otherVoiceChannels: Channel[] = [];
    if (guildChannels && guildChannels.VOCAL) {
        // @ts-ignore
        otherVoiceChannels = guildChannels.VOCAL
            .map((w: any) => w.channel)
            .filter((c: Channel) => c.id !== channel.id)
            .sort((a: Channel, b: Channel) => a.position - b.position);
    }

    children.splice(
        -1,
        0,
        <Menu.MenuItem
            label="Ses Araçları"
            key="voice-tools-fixed"
            id="voice-tools-fixed"
        >
            <Menu.MenuItem
                key="vt-move-all"
                id="vt-move-all"
                label="Hepsini Taşı..."
            >
                {otherVoiceChannels.map((vc) => (
                    <Menu.MenuItem
                        key={vc.id}
                        id={vc.id}
                        label={vc.name}
                        action={() => Actions.move(channel, vc.id)}
                    />
                ))}
            </Menu.MenuItem>

            <Menu.MenuItem
                key="vt-disconnect-all"
                id="vt-disconnect-all"
                label="Hepsini Çıkar"
                color="danger"
                action={() => Actions.disconnect(channel)}
            />

            <Menu.MenuSeparator />

            <Menu.MenuItem
                key="vt-mute-all"
                id="vt-mute-all"
                label="Hepsini Sustur"
                action={() => Actions.mute(channel, true)}
            />
            <Menu.MenuItem
                key="vt-unmute-all"
                id="vt-unmute-all"
                label="Susturmayı Kaldır"
                action={() => Actions.mute(channel, false)}
            />

            <Menu.MenuSeparator />

            <Menu.MenuItem
                key="vt-deafen-all"
                id="vt-deafen-all"
                label="Hepsini Sağırlaştır"
                action={() => Actions.deafen(channel, true)}
            />
            <Menu.MenuItem
                key="vt-undeafen-all"
                id="vt-undeafen-all"
                label="Sağırlaştırmayı Kaldır"
                action={() => Actions.deafen(channel, false)}
            />
        </Menu.MenuItem>
    );
};


export default definePlugin({
    name: "ParanoidSesKontrol",
    description: "Ses kanalındaki kullanıcıları toplu olarak yönet (Taşı, Sustur, Sağırlaştır, Çıkar) | Developed by paranoid",
    authors: [{ id: 323805972101464065, name: "paranoid" }],
    settings,
    contextMenus: {
        "channel-context": VoiceChannelContext
    },
});
