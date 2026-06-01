#include "hostqt/channels/filechannel.h"

#include <QBuffer>
#include <QClipboard>
#include <QColor>
#include <QDateTime>
#include <QFile>
#include <QFileInfo>
#include <QFileDialog>
#include <QImage>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMimeData>
#include <QGuiApplication>
#include <QSet>

namespace hostqt {

namespace {
QSet<QString> transientParseFailures;
}

FileChannel::FileChannel(QObject *parent)
    : QObject(parent)
{
}

QString FileChannel::validateIncomingPaths(const QString &params) const
{
    QJsonObject payload = QJsonDocument::fromJson(params.toUtf8()).object();
    QJsonArray accepted;

    for (const QJsonValue &value : payload.value(QStringLiteral("paths")).toArray()) {
        const QString path = value.toString();
        if (!path.isEmpty() && QFileInfo::exists(path)) {
            accepted.append(path);
        }
    }

    return QString::fromUtf8(QJsonDocument(QJsonObject{{QStringLiteral("paths"), accepted}}).toJson(QJsonDocument::Compact));
}

void FileChannel::handleDroppedFiles(const QString &params)
{
    const QJsonObject payload = QJsonDocument::fromJson(params.toUtf8()).object();
    const QString defaultPrompt = payload.value(QStringLiteral("default_prompt")).toString();
    const int category = payload.value(QStringLiteral("category")).toInt(0);

    for (const QJsonValue &value : payload.value(QStringLiteral("paths")).toArray()) {
        const QString path = value.toString();
        if (path.isEmpty() || !QFileInfo::exists(path)) {
            continue;
        }

        const QFileInfo info(path);
        emit fileEvent(
            1,
            QString::number(QDateTime::currentMSecsSinceEpoch()),
            QString::fromUtf8(
                QJsonDocument(
                    QJsonObject{
                        {QStringLiteral("file_path"), path},
                        {QStringLiteral("file_size"), static_cast<qint64>(info.size())},
                        {QStringLiteral("icon"), getFileIconBase64(path)},
                        {QStringLiteral("default_prompt"), defaultPrompt},
                        {QStringLiteral("category"), category},
                        {QStringLiteral("error"), 0},
                    })
                    .toJson(QJsonDocument::Compact)));
    }
}

void FileChannel::handleCopiedFiles(const QString &params)
{
    handleDroppedFiles(params);
}

void FileChannel::handleScreenshotFile(const QString &params)
{
    const QJsonObject payload = QJsonDocument::fromJson(params.toUtf8()).object();
    const QString path = payload.value(QStringLiteral("path")).toString();
    if (path.isEmpty() || !QFileInfo::exists(path)) {
        return;
    }

    const QFileInfo info(path);
    emit fileEvent(
        1,
        QString::number(QDateTime::currentMSecsSinceEpoch()),
        QString::fromUtf8(
            QJsonDocument(
                QJsonObject{
                    {QStringLiteral("file_path"), path},
                    {QStringLiteral("file_size"), static_cast<qint64>(info.size())},
                    {QStringLiteral("icon"), getFileIconBase64(path)},
                    {QStringLiteral("default_prompt"), QString()},
                    {QStringLiteral("error"), 0},
                })
                .toJson(QJsonDocument::Compact)));
}

void FileChannel::parseFile(const QString &, const QString &filePath)
{
    if (!QFileInfo::exists(filePath)) {
        emit fileEvent(
            2,
            QString(),
            QString::fromUtf8(
                QJsonDocument(
                    QJsonObject{
                        {QStringLiteral("file_path"), filePath},
                        {QStringLiteral("error"), -1},
                    })
                    .toJson(QJsonDocument::Compact)));
        return;
    }

    if (filePath.contains(QStringLiteral("force-parse-error")) &&
        !transientParseFailures.contains(filePath)) {
        transientParseFailures.insert(filePath);
        emit fileEvent(
            2,
            QString(),
            QString::fromUtf8(
                QJsonDocument(
                    QJsonObject{
                        {QStringLiteral("file_path"), filePath},
                        {QStringLiteral("error"), -2},
                    })
                    .toJson(QJsonDocument::Compact)));
        return;
    }

    emit fileEvent(
        2,
        QString(),
        QString::fromUtf8(
            QJsonDocument(
                QJsonObject{
                    {QStringLiteral("file_path"), filePath},
                    {QStringLiteral("error"), 0},
                })
                .toJson(QJsonDocument::Compact)));
}

void FileChannel::removeFile(const QString &) {}
bool FileChannel::isFileExist(const QString &filePath) const { return QFileInfo::exists(filePath); }
QString FileChannel::getFileIconBase64(const QString &, int width, int height) const
{
    QImage image(width > 0 ? width : 16, height > 0 ? height : 16, QImage::Format_ARGB32_Premultiplied);
    image.fill(QColor(QStringLiteral("#D9E7FF")));
    QBuffer buffer;
    buffer.open(QIODevice::WriteOnly);
    image.save(&buffer, "PNG");
    return QString::fromLatin1(buffer.data().toBase64());
}

QString FileChannel::processClipboardData() const
{
    const QClipboard *clipboard = QGuiApplication::clipboard();
    if (!clipboard) {
        return QString();
    }

    return clipboard->text();
}
bool FileChannel::isEnableScreenshot() const { return false; }
void FileChannel::startScreenshot() {}
void FileChannel::selectFile(const QString &params)
{
    const QJsonObject payload = QJsonDocument::fromJson(params.toUtf8()).object();
    const bool multiple = payload.value(QStringLiteral("multiple")).toBool(false);
    const int category = payload.value(QStringLiteral("category")).toInt(0);

    QStringList selectedPaths;
    if (multiple) {
        selectedPaths = QFileDialog::getOpenFileNames(nullptr, QStringLiteral("Select Files"));
    } else {
        const QString selected = QFileDialog::getOpenFileName(nullptr, QStringLiteral("Select File"));
        if (!selected.isEmpty()) {
            selectedPaths << selected;
        }
    }

    if (selectedPaths.isEmpty()) {
        return;
    }

    emit fileEvent(
        4,
        QString(),
        QString::fromUtf8(
            QJsonDocument(
                QJsonObject{
                    {QStringLiteral("paths"), QJsonArray::fromStringList(selectedPaths)},
                    {QStringLiteral("category"), category},
                    {QStringLiteral("backend_method"), QStringLiteral("handleDroppedFiles")},
                    {QStringLiteral("default_prompt"), QString()},
                })
                .toJson(QJsonDocument::Compact)));
}
void FileChannel::setCurrentAssistantId(const QString &) {}

} // namespace hostqt
