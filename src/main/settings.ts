import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { AppSettings, SailorSettings, ColimaSettings, DockerSettings, NotificationSettings } from '@common/types';

const DEFAULT_SETTINGS: AppSettings = {
    sailor: {
        startOnLogin: false,
        stopOnExit: false
    },
    colima: {
        activeInstance: 'default'
    },
    docker: {
        activeContext: 'colima'
    },
    notifications: {
        acknowledgedVersions: {}
    }
};

class SettingsManager {
    private settingsPath: string;
    private settings: AppSettings;

    constructor() {
        this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
        this.settings = this.load();
    }

    private load(): AppSettings {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const data = fs.readFileSync(this.settingsPath, 'utf8');
                const loaded = JSON.parse(data);
                // Merge with defaults to ensure all keys exist
                return {
                    sailor: { ...DEFAULT_SETTINGS.sailor, ...loaded.sailor },
                    colima: { ...DEFAULT_SETTINGS.colima, ...loaded.colima },
                    docker: { ...DEFAULT_SETTINGS.docker, ...loaded.docker },
                    notifications: { ...DEFAULT_SETTINGS.notifications, ...loaded.notifications }
                };
            }
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
        return { ...DEFAULT_SETTINGS };
    }

    private save(): void {
        try {
            const dir = path.dirname(this.settingsPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
        } catch (err) {
            console.error('Failed to save settings:', err);
        }
    }

    getAll(): AppSettings {
        return { ...this.settings };
    }

    getSailor(): SailorSettings {
        return { ...this.settings.sailor };
    }

    setSailor(settings: Partial<SailorSettings>): SailorSettings {
        this.settings.sailor = { ...this.settings.sailor, ...settings };
        this.save();
        this.applyStartOnLogin();
        return this.settings.sailor;
    }

    getColima(): ColimaSettings {
        return { ...this.settings.colima };
    }

    setColima(settings: Partial<ColimaSettings>): ColimaSettings {
        this.settings.colima = { ...this.settings.colima, ...settings };
        this.save();
        return this.settings.colima;
    }

    getDocker(): DockerSettings {
        return { ...this.settings.docker };
    }

    setDocker(settings: Partial<DockerSettings>): DockerSettings {
        this.settings.docker = { ...this.settings.docker, ...settings };
        this.save();
        return this.settings.docker;
    }

    getNotifications(): NotificationSettings {
        return { ...this.settings.notifications };
    }

    acknowledgeNotification(notificationId: string, version: string): NotificationSettings {
        this.settings.notifications.acknowledgedVersions[notificationId] = version;
        this.save();
        return this.settings.notifications;
    }

    isNotificationAcknowledged(notificationId: string, currentVersion: string): boolean {
        const acknowledgedVersion = this.settings.notifications.acknowledgedVersions[notificationId];
        return acknowledgedVersion === currentVersion;
    }

    clearAcknowledgedNotification(notificationId: string): void {
        delete this.settings.notifications.acknowledgedVersions[notificationId];
        this.save();
    }

    private applyStartOnLogin(): void {
        app.setLoginItemSettings({
            openAtLogin: this.settings.sailor.startOnLogin,
            openAsHidden: false
        });
    }

    applyAllSettings(): void {
        this.applyStartOnLogin();
    }
}

export default SettingsManager;
