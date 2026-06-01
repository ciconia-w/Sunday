#include "hostqt/channels/skillschannel.h"
#include "hostqt/sidecarclient.h"

#include <QJsonArray>

namespace hostqt {

SkillsChannel::SkillsChannel(QObject *parent)
    : QObject(parent)
{
}

void SkillsChannel::setSidecarClient(SidecarClient *client)
{
    m_sidecarClient = client;
}

QJsonArray SkillsChannel::skillsData() const
{
    if (!m_sidecarClient) {
        return QJsonArray();
    }

    return m_sidecarClient->postJsonValueSync(QStringLiteral("/skills/data"), QVariantMap()).toArray();
}

void SkillsChannel::reloadSkills()
{
    if (!m_sidecarClient) {
        return;
    }

    m_sidecarClient->postJsonValueSync(QStringLiteral("/skills/reload"), QVariantMap());
}

bool SkillsChannel::setSkillEnabled(const QString &skillName, bool enabled)
{
    if (!m_sidecarClient) {
        return false;
    }

    return m_sidecarClient->postJsonValueSync(
               QStringLiteral("/skills/set-enabled"),
               QVariantMap{
                   {QStringLiteral("skillName"), skillName},
                   {QStringLiteral("enabled"), enabled},
               })
        .toBool();
}

bool SkillsChannel::hasSkill(const QString &skillName) const
{
    if (!m_sidecarClient) {
        return false;
    }

    return m_sidecarClient->postJsonValueSync(
               QStringLiteral("/skills/has"),
               QVariantMap{{QStringLiteral("skillName"), skillName}})
        .toBool();
}

QJsonObject SkillsChannel::addSkillForWeb() const
{
    QJsonObject root;
    root.insert("success", false);
    root.insert("error", QStringLiteral("not implemented"));
    return root;
}
bool SkillsChannel::removeSkill(const QString &skillName)
{
    if (!m_sidecarClient) {
        return false;
    }

    return m_sidecarClient->postJsonValueSync(
               QStringLiteral("/skills/remove"),
               QVariantMap{{QStringLiteral("skillName"), skillName}})
        .toBool();
}

} // namespace hostqt
