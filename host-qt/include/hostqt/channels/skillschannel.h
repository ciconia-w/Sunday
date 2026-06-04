#pragma once

#include <QObject>
#include <QJsonArray>
#include <QJsonObject>

namespace hostqt {

class SidecarClient;

class SkillsChannel : public QObject
{
    Q_OBJECT
public:
    explicit SkillsChannel(QObject *parent = nullptr);
    void setSidecarClient(SidecarClient *client);

public slots:
    QJsonArray skillsData() const;
    void reloadSkills();
    bool setSkillEnabled(const QString &skillName, bool enabled);
    bool hasSkill(const QString &skillName) const;
    QJsonObject addSkillForWeb() const;
    QJsonObject addGithubSkillForWeb(const QString &repoInput) const;
    bool removeSkill(const QString &skillName);

private:
    SidecarClient *m_sidecarClient = nullptr;
};

} // namespace hostqt
