#include "hostqt/appwindow.h"
#include "hostqt/hostcontext.h"
#include "hostqt/sidecarsupervisor.h"
#include "hostqt/sidecarclient.h"
#include "hostqt/sidecareventstream.h"

#include <QApplication>
#include <QDir>
#include <QProcessEnvironment>
#include <QTimer>
#include <QUrl>

using namespace hostqt;

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);

    HostContext context;
    context.window = new WindowChannel();
    context.system = new SystemChannel();
    context.file = new FileChannel();
    context.task = new TaskChannel();
    context.audio = new AudioChannel();
    context.session = new SessionChannel();
    context.assistant = new AssistantChannel();
    context.conversation = new ConversationChannel();
    context.serviceConfig = new ServiceConfigChannel();
    context.skills = new SkillsChannel();
    context.report = new ReportChannel();
    const QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
    const QString frontUrl = env.value(QStringLiteral("PERSONAL_AGENT_FRONT_URL"), QStringLiteral("http://127.0.0.1:4173"));
    const QString sidecarBaseUrl = env.value(QStringLiteral("PERSONAL_AGENT_SIDECAR_URL"), QStringLiteral("http://127.0.0.1:8787"));
    const bool autoStartSidecar = env.value(QStringLiteral("PERSONAL_AGENT_AUTOSTART_SIDECAR"), QStringLiteral("1")) != QStringLiteral("0");
    const int smokeExitMs = env.value(QStringLiteral("PERSONAL_AGENT_SMOKE_EXIT_MS"), QStringLiteral("0")).toInt();

    context.sidecar = new SidecarClient();
    context.sidecar->setBaseUrl(QUrl(sidecarBaseUrl));
    context.sidecarEvents = new SidecarEventStream();
    context.sidecarEvents->setBaseUrl(QUrl(sidecarBaseUrl));
    context.assistant->setSidecarClient(context.sidecar);
    context.session->setSidecarClient(context.sidecar);
    context.session->setSidecarEventStream(context.sidecarEvents);
    context.conversation->setSidecarClient(context.sidecar);
    context.serviceConfig->setSidecarClient(context.sidecar);
    context.skills->setSidecarClient(context.sidecar);

    SidecarSupervisor sidecar;
    sidecar.setProgram(QStringLiteral("node"));
    sidecar.setArguments(QStringList() << QStringLiteral("./src/dev-server.mjs"));
    sidecar.setWorkingDirectory(QDir::homePath() + QStringLiteral("/personal-agent-desktop/pi-sidecar"));

    int code = 0;
    {
        AppWindow window;
        window.setSidecarSupervisor(&sidecar);
        window.initialize(&context, QUrl::fromUserInput(frontUrl));
        window.show();

        if (autoStartSidecar)
            sidecar.start();
        context.sidecarEvents->start();
        if (smokeExitMs > 0) {
            QTimer::singleShot(smokeExitMs, &app, &QApplication::quit);
        }
        code = app.exec();
        context.sidecarEvents->stop();
        if (autoStartSidecar)
            sidecar.stop();
    }
    context.reset();
    return code;
}
