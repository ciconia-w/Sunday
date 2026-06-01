cmake_minimum_required(VERSION 3.16)

project(personal_agent_host_qt LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

find_package(QT NAMES Qt6 Qt5 REQUIRED COMPONENTS Core Gui Widgets WebEngineWidgets WebChannel)
find_package(Qt${QT_VERSION_MAJOR} REQUIRED COMPONENTS Core Gui Widgets WebEngineWidgets WebChannel)

add_executable(personal-agent-host
    include/hostqt/appwindow.h
    include/hostqt/hostcontext.h
    include/hostqt/sidecarsupervisor.h
    include/hostqt/sidecarclient.h
    include/hostqt/sidecareventstream.h
    include/hostqt/webpage.h
    include/hostqt/channels/windowchannel.h
    include/hostqt/channels/systemchannel.h
    include/hostqt/channels/filechannel.h
    include/hostqt/channels/taskchannel.h
    include/hostqt/channels/audiochannel.h
    include/hostqt/channels/sessionchannel.h
    include/hostqt/channels/assistantchannel.h
    include/hostqt/channels/conversationchannel.h
    include/hostqt/channels/serviceconfigchannel.h
    include/hostqt/channels/skillschannel.h
    include/hostqt/channels/reportchannel.h
    src/main.cpp
    src/appwindow.cpp
    src/hostcontext.cpp
    src/sidecarsupervisor.cpp
    src/sidecarclient.cpp
    src/sidecareventstream.cpp
    src/webpage.cpp
    src/channels/windowchannel.cpp
    src/channels/systemchannel.cpp
    src/channels/filechannel.cpp
    src/channels/taskchannel.cpp
    src/channels/audiochannel.cpp
    src/channels/sessionchannel.cpp
    src/channels/assistantchannel.cpp
    src/channels/conversationchannel.cpp
    src/channels/serviceconfigchannel.cpp
    src/channels/skillschannel.cpp
    src/channels/reportchannel.cpp
)

add_executable(personal-agent-filechannel-smoke
    include/hostqt/channels/filechannel.h
    src/channels/filechannel.cpp
    src/filechannel_smoke.cpp
)

add_executable(personal-agent-systemchannel-smoke
    include/hostqt/channels/systemchannel.h
    src/channels/systemchannel.cpp
    src/systemchannel_smoke.cpp
)

target_include_directories(personal-agent-host PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_include_directories(personal-agent-filechannel-smoke PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_include_directories(personal-agent-systemchannel-smoke PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(personal-agent-host PRIVATE
    Qt${QT_VERSION_MAJOR}::Core
    Qt${QT_VERSION_MAJOR}::Gui
    Qt${QT_VERSION_MAJOR}::Widgets
    Qt${QT_VERSION_MAJOR}::Network
    Qt${QT_VERSION_MAJOR}::WebEngineWidgets
    Qt${QT_VERSION_MAJOR}::WebChannel
)

target_link_libraries(personal-agent-filechannel-smoke PRIVATE
    Qt${QT_VERSION_MAJOR}::Core
    Qt${QT_VERSION_MAJOR}::Gui
    Qt${QT_VERSION_MAJOR}::Widgets
)

target_link_libraries(personal-agent-systemchannel-smoke PRIVATE
    Qt${QT_VERSION_MAJOR}::Core
    Qt${QT_VERSION_MAJOR}::Gui
    Qt${QT_VERSION_MAJOR}::Widgets
)
