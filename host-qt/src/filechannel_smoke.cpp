#include "hostqt/channels/filechannel.h"

#include <QApplication>
#include <QClipboard>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTemporaryDir>
#include <QFile>
#include <QTextStream>

using namespace hostqt;

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);

    FileChannel fileChannel;

    QJsonArray capturedEvents;
    QObject::connect(&fileChannel, &FileChannel::fileEvent, [&](int event, const QString &id, const QString &json) {
        capturedEvents.append(QJsonObject{
            {QStringLiteral("event"), event},
            {QStringLiteral("id"), id},
            {QStringLiteral("payload"), QJsonDocument::fromJson(json.toUtf8()).object()},
        });
    });

    QTemporaryDir tempDir;
    if (!tempDir.isValid()) {
        QTextStream(stderr) << "failed to create temp dir\n";
        return 1;
    }

    const QString filePath = tempDir.path() + QStringLiteral("/sample.txt");
    QFile file(filePath);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Text)) {
        QTextStream(stderr) << "failed to create sample file\n";
        return 1;
    }
    file.write("hello-file-channel\n");
    file.close();

    const QString validateResponse = fileChannel.validateIncomingPaths(
        QString::fromUtf8(
            QJsonDocument(
                QJsonObject{
                    {QStringLiteral("paths"), QJsonArray{filePath}},
                    {QStringLiteral("show_unsupported_toast"), false},
                })
                .toJson(QJsonDocument::Compact)));
    const QJsonArray validatedPaths =
        QJsonDocument::fromJson(validateResponse.toUtf8()).object().value(QStringLiteral("paths")).toArray();

    const bool existsBefore = fileChannel.isFileExist(filePath);
    const QString iconBase64 = fileChannel.getFileIconBase64(filePath, 16, 16);

    fileChannel.handleDroppedFiles(
        QString::fromUtf8(
            QJsonDocument(
                QJsonObject{
                    {QStringLiteral("paths"), QJsonArray{filePath}},
                    {QStringLiteral("default_prompt"), QStringLiteral("summarize this file")},
                    {QStringLiteral("category"), 0},
                })
                .toJson(QJsonDocument::Compact)));

    fileChannel.parseFile(QStringLiteral("file-1"), filePath);

    QGuiApplication::clipboard()->setText(QStringLiteral("clipboard-text"));
    const QString clipboardText = fileChannel.processClipboardData();

    const QJsonObject result{
        {QStringLiteral("validatedPaths"), validatedPaths},
        {QStringLiteral("existsBefore"), existsBefore},
        {QStringLiteral("iconPresent"), !iconBase64.isEmpty()},
        {QStringLiteral("clipboardText"), clipboardText},
        {QStringLiteral("events"), capturedEvents},
    };

    const bool verdict =
        existsBefore &&
        !iconBase64.isEmpty() &&
        clipboardText == QStringLiteral("clipboard-text") &&
        !capturedEvents.isEmpty() &&
        validatedPaths.contains(filePath);

    QJsonObject output = result;
    output.insert(QStringLiteral("verdict"), verdict ? QStringLiteral("file-channel-confirmed")
                                                     : QStringLiteral("file-channel-incomplete"));

    QTextStream(stdout) << QJsonDocument(output).toJson(QJsonDocument::Indented);
    return verdict ? 0 : 1;
}
