#pragma once

#include <QObject>
#include <QJsonObject>

namespace hostqt {

class WindowChannel : public QObject
{
    Q_OBJECT
public:
    explicit WindowChannel(QObject *parent = nullptr);

signals:
    void windowFontChanged(const QString &fontInfo);
    void windowStateChanged(int state);
    void windowModeChanged(int mode);
    void windowShown();
    void windowAppendPrompt(const QString &question, bool isSend);
    void windowOverrideQuestion(const QString &question);
    void windowChangeToDigitalMode();
    void toastRequested(const QString &type, const QString &message);

public slots:
    int windowMode() const;
    void switchMode(int mode);
    void minimize();
    void maximize();
    void restore();
    void close();
    void startMove(int startX, int startY, int currentX, int currentY);
    void systemMenu();
    void ensureMinimumWidth(int width);
    void saveMainWindowSidebarState(int width, bool expanded);
    void saveMainWindowSidebarGroupCollapsedStates(const QString &json);
    QJsonObject getMainWindowSidebarState() const;
    bool isMainWindowActive() const;
    bool shouldShowNewUserGuideOnStartup() const;
    void recordNewUserGuideShown();
    void showConfig(int page);
    void showHelpWindow();
    void showAboutWindow();
    void showUpdateLogWindow();

private:
    int m_windowMode = 0;
};

} // namespace hostqt

