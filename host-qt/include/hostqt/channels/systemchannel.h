#pragma once

#include <QObject>
#include <QJsonObject>
#include <QString>

namespace hostqt {

class SystemChannel : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString activeColor READ activeColor NOTIFY activeColorChanged)
    Q_PROPERTY(QString fontInfo READ fontInfo NOTIFY fontChanged)
    Q_PROPERTY(int themeColor READ themeColor NOTIFY themeColorChanged)
    Q_PROPERTY(bool networkStatus READ networkStatus NOTIFY networkChanged)
public:
    explicit SystemChannel(QObject *parent = nullptr);

    QString activeColor() const;
    QString fontInfo() const;
    int themeColor() const;
    bool networkStatus() const;

signals:
    void activeColorChanged(const QString &color);
    void networkChanged(bool online);
    void themeColorChanged(int value);
    void themeIconChanged();
    void fontChanged(const QString &fontInfo);
    void notificationActionInvoked(unsigned int notificationId, const QString &actionKey);
    void appUpdateAvailable(const QJsonObject &info);

public slots:
    QString getIconBase64(const QString &iconName, int width = 16, int height = 16) const;
    QJsonObject loadTranslations() const;
    bool checkChineseLanguage() const;
    bool isEnableAdvancedCssFeatures() const;
    void copyToClipboard(const QString &data, int type);
    void openFile(const QString &filePath);
    void openUrl(const QString &url);
    void closeNotification(unsigned int notificationId);
    void checkAppUpdate();
    void markAppUpdateReminderConsumed(const QString &version);
    int themeColorOption() const;
    void switchThemeColor(int value);
    QString getCurrentShortcut() const;
    QString getCurrentTalkShortcut() const;
    QString runCliCommand(const QString &command) const;
};

} // namespace hostqt
