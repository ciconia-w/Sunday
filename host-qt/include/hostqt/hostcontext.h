#pragma once

#include "hostqt/channels/audiochannel.h"
#include "hostqt/channels/assistantchannel.h"
#include "hostqt/channels/conversationchannel.h"
#include "hostqt/channels/filechannel.h"
#include "hostqt/channels/reportchannel.h"
#include "hostqt/channels/serviceconfigchannel.h"
#include "hostqt/channels/sessionchannel.h"
#include "hostqt/channels/skillschannel.h"
#include "hostqt/channels/systemchannel.h"
#include "hostqt/channels/taskchannel.h"
#include "hostqt/channels/windowchannel.h"
#include "hostqt/sidecarclient.h"
#include "hostqt/sidecareventstream.h"

namespace hostqt {

struct HostContext
{
    WindowChannel *window = nullptr;
    SystemChannel *system = nullptr;
    FileChannel *file = nullptr;
    TaskChannel *task = nullptr;
    AudioChannel *audio = nullptr;
    SessionChannel *session = nullptr;
    AssistantChannel *assistant = nullptr;
    ConversationChannel *conversation = nullptr;
    ServiceConfigChannel *serviceConfig = nullptr;
    SkillsChannel *skills = nullptr;
    ReportChannel *report = nullptr;
    SidecarClient *sidecar = nullptr;
    SidecarEventStream *sidecarEvents = nullptr;

    void reset();
};

} // namespace hostqt
