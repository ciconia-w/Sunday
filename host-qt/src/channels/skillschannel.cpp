#include "hostqt/channels/skillschannel.h"
#include "hostqt/sidecarclient.h"

#include <QFileDialog>
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

QJsonObject SkillsChannel::getSkillsSourceOfTruth() const
{
    if (!m_sidecarClient) {
        return QJsonObject();
    }

    return m_sidecarClient->postJsonValueSync(QStringLiteral("/skills/source-of-truth"), QVariantMap()).toObject();
}

QJsonObject SkillsChannel::addSkillForWeb() const
{
    QJsonObject root;
    if (!m_sidecarClient) {
        root.insert("success", false);
        root.insert("error", QStringLiteral("sidecar unavailable"));
        return root;
    }

    const QString selectedDir = QFileDialog::getExistingDirectory(
        nullptr,
        QStringLiteral("选择技能目录"),
        QString());
    if (selectedDir.isEmpty()) {
        root.insert("success", false);
        root.insert("cancelled", true);
        return root;
    }

    QString errorMessage;
    const QJsonObject importedSkill = m_sidecarClient->postJsonSync(
        QStringLiteral("/skills/import-local"),
        QVariantMap{{QStringLiteral("sourcePath"), selectedDir}},
        &errorMessage);
    if (!errorMessage.isEmpty()) {
        root.insert("success", false);
        root.insert("error", errorMessage);
        return root;
    }

    root.insert("success", true);
    root.insert("skill", importedSkill);
    return root;
}

QJsonObject SkillsChannel::addGithubSkillForWeb(const QString &repoInput) const
{
    QJsonObject root;
    if (!m_sidecarClient) {
        root.insert("success", false);
        root.insert("error", QStringLiteral("sidecar unavailable"));
        return root;
    }

    const QString normalizedInput = repoInput.trimmed();
    if (normalizedInput.isEmpty()) {
        root.insert("success", false);
        root.insert("error", QStringLiteral("GitHub repository input is required"));
        return root;
    }

    QString errorMessage;
    const QJsonObject importedSkill = m_sidecarClient->postJsonSync(
        QStringLiteral("/skills/import-github"),
        QVariantMap{{QStringLiteral("repoInput"), normalizedInput}},
        &errorMessage);
    if (!errorMessage.isEmpty()) {
        root.insert("success", false);
        root.insert("error", errorMessage);
        return root;
    }

    root.insert("success", true);
    root.insert("skill", importedSkill);
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
