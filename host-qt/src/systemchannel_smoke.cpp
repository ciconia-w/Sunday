#include "hostqt/channels/systemchannel.h"

#include <QApplication>
#include <QClipboard>
#include <QTextStream>

using namespace hostqt;

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);

    SystemChannel system;
    const QString clipboardValue = QStringLiteral("system-channel-clipboard");
    system.copyToClipboard(clipboardValue, 0);

    const QString readBack = QGuiApplication::clipboard() ? QGuiApplication::clipboard()->text() : QString();

    const bool verdict = readBack == clipboardValue &&
        system.activeColor() == QStringLiteral("#0081ff") &&
        system.fontInfo() == QStringLiteral("Noto Sans#14") &&
        system.themeColor() == 1 &&
        system.networkStatus() == true;

    QTextStream(stdout)
        << "{\n"
        << "  \"clipboardValue\": \"" << readBack << "\",\n"
        << "  \"activeColor\": \"" << system.activeColor() << "\",\n"
        << "  \"fontInfo\": \"" << system.fontInfo() << "\",\n"
        << "  \"themeColor\": " << system.themeColor() << ",\n"
        << "  \"networkStatus\": " << (system.networkStatus() ? "true" : "false") << ",\n"
        << "  \"verdict\": \"" << (verdict ? "system-channel-confirmed" : "system-channel-incomplete") << "\"\n"
        << "}\n";

    return verdict ? 0 : 1;
}
