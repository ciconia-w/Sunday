#include "hostqt/channels/systemchannel.h"

#include <QClipboard>
#include <QDebug>
#include <QDesktopServices>
#include <QGuiApplication>
#include <QProcess>
#include <QUrl>

namespace hostqt {

SystemChannel::SystemChannel(QObject *parent)
    : QObject(parent)
{
}

QString SystemChannel::activeColor() const { return "#0081ff"; }
QString SystemChannel::fontInfo() const { return "Noto Sans#14"; }
int SystemChannel::themeColor() const { return 1; }
bool SystemChannel::networkStatus() const { return true; }
QString SystemChannel::getIconBase64(const QString &, int, int) const { return QString(); }
QJsonObject SystemChannel::loadTranslations() const { return QJsonObject(); }
bool SystemChannel::checkChineseLanguage() const { return true; }
bool SystemChannel::isEnableAdvancedCssFeatures() const { return true; }
void SystemChannel::copyToClipboard(const QString &data, int) {
    if (QClipboard *clipboard = QGuiApplication::clipboard()) {
        clipboard->setText(data);
    }
}
void SystemChannel::openFile(const QString &filePath) {
    if (filePath.isEmpty()) {
        return;
    }
    qInfo().noquote() << "[host-qt system] openFile" << filePath;
    QDesktopServices::openUrl(QUrl::fromLocalFile(filePath));
}
void SystemChannel::openUrl(const QString &url) {
    if (url.isEmpty()) {
        return;
    }
    QDesktopServices::openUrl(QUrl(url));
}
void SystemChannel::closeNotification(unsigned int) {}
void SystemChannel::checkAppUpdate() {}
void SystemChannel::markAppUpdateReminderConsumed(const QString &) {}
int SystemChannel::themeColorOption() const { return 0; }
void SystemChannel::switchThemeColor(int value) { emit themeColorChanged(value); }
QString SystemChannel::getCurrentShortcut() const { return QString(); }
QString SystemChannel::getCurrentTalkShortcut() const { return QString(); }
QString SystemChannel::runCliCommand(const QString &command) const {
    if (command.trimmed().isEmpty()) {
        return QString();
    }

    QProcess process;
    process.start(QStringLiteral("/bin/bash"), {QStringLiteral("-lc"), command});
    if (!process.waitForStarted(3000)) {
        return QStringLiteral("Failed to start command");
    }

    process.waitForFinished(15000);
    const QString stdoutText = QString::fromUtf8(process.readAllStandardOutput());
    const QString stderrText = QString::fromUtf8(process.readAllStandardError());

    if (!stdoutText.isEmpty()) {
        return stdoutText;
    }

    return stderrText;
}

} // namespace hostqt
