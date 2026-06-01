#pragma once

#include <QWebEnginePage>

namespace hostqt {

class WebPage : public QWebEnginePage
{
    Q_OBJECT
public:
    explicit WebPage(QObject *parent = nullptr);

protected:
    void javaScriptConsoleMessage(
        JavaScriptConsoleMessageLevel level,
        const QString &message,
        int lineNumber,
        const QString &sourceID) override;
};

} // namespace hostqt

