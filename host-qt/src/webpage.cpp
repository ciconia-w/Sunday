#include "hostqt/webpage.h"

#include <QDebug>

namespace hostqt {

WebPage::WebPage(QObject *parent)
    : QWebEnginePage(parent)
{
}

void WebPage::javaScriptConsoleMessage(
    JavaScriptConsoleMessageLevel level,
    const QString &message,
    int lineNumber,
    const QString &sourceID)
{
    const QString normalizedMessage = message.trimmed();

    // Ignore expected legacy bootstrap noise from the static Vite bundle under older Qt WebEngine.
    if (normalizedMessage.contains(QStringLiteral("import.meta.resolve not supported"))
        || normalizedMessage.contains(QStringLiteral("vite: loading legacy chunks, syntax error above and the same error below should be ignored"))
        || normalizedMessage.contains(QStringLiteral("[remote channels] failed to fetch /state"))
        || normalizedMessage.contains(QStringLiteral("ResizeObserver loop limit exceeded"))) {
        return;
    }

    qWarning().noquote()
        << "[host-qt web]"
        << "level=" << level
        << "source=" << sourceID
        << "line=" << lineNumber
        << normalizedMessage;
}

} // namespace hostqt
