#pragma once

#include <QObject>
#include <QString>

namespace hostqt {

class FileChannel : public QObject
{
    Q_OBJECT
public:
    explicit FileChannel(QObject *parent = nullptr);

signals:
    void fileEvent(int event, const QString &id, const QString &json);

public slots:
    QString validateIncomingPaths(const QString &params) const;
    void handleDroppedFiles(const QString &params);
    void handleCopiedFiles(const QString &params);
    void handleScreenshotFile(const QString &params);
    void parseFile(const QString &id, const QString &filePath);
    void removeFile(const QString &filePath);
    bool isFileExist(const QString &filePath) const;
    QString getFileIconBase64(const QString &filePath, int width = 16, int height = 16) const;
    QString processClipboardData() const;
    bool isEnableScreenshot() const;
    void startScreenshot();
    void selectFile(const QString &params);
    void setCurrentAssistantId(const QString &assistantId);
};

} // namespace hostqt
