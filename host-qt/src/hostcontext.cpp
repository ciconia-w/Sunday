#include "hostqt/hostcontext.h"

namespace hostqt {

void HostContext::reset()
{
    delete window;
    delete system;
    delete file;
    delete task;
    delete audio;
    delete session;
    delete assistant;
    delete conversation;
    delete serviceConfig;
    delete skills;
    delete report;
    delete sidecar;
    delete sidecarEvents;

    window = nullptr;
    system = nullptr;
    file = nullptr;
    task = nullptr;
    audio = nullptr;
    session = nullptr;
    assistant = nullptr;
    conversation = nullptr;
    serviceConfig = nullptr;
    skills = nullptr;
    report = nullptr;
    sidecar = nullptr;
    sidecarEvents = nullptr;
}

} // namespace hostqt
