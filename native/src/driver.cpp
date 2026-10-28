#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>

#include <openvr_driver.h>

#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>

namespace {

constexpr unsigned short kPort = 26760;
constexpr std::size_t kFieldCount = 29;
constexpr auto kTrackingTimeout = std::chrono::milliseconds(500);

struct TrackingPacket {
    std::array<float, kFieldCount> values{};
    std::chrono::steady_clock::time_point receivedAt{};
    bool received = false;
};

class Device final : public vr::ITrackedDeviceServerDriver, public vr::IVRDisplayComponent {
public:
    Device(const char* serial, bool isHmd, vr::ETrackedControllerRole role)
        : serial_(serial), isHmd_(isHmd), role_(role) {}

    vr::EVRInitError Activate(uint32_t objectId) override {
        deviceIndex_ = objectId;
        active_ = true;
        const auto container = vr::VRProperties()->TrackedDeviceToPropertyContainer(deviceIndex_);
        vr::VRProperties()->SetStringProperty(container, vr::Prop_ModelNumber_String,
            isHmd_ ? "CamVR Webcam HMD" : "CamVR Hand Controller");
        vr::VRProperties()->SetStringProperty(container, vr::Prop_ManufacturerName_String, "CamVR");
        vr::VRProperties()->SetStringProperty(container, vr::Prop_TrackingSystemName_String, "camvr");
        vr::VRProperties()->SetStringProperty(container, vr::Prop_SerialNumber_String, serial_.c_str());
        vr::VRProperties()->SetStringProperty(container, vr::Prop_RegisteredDeviceType_String,
            isHmd_ ? "camvr/camvr_hmd" : "camvr/camvr_controller");

        if (isHmd_) {
            vr::VRProperties()->SetFloatProperty(container, vr::Prop_DisplayFrequency_Float, 60.0F);
            vr::VRProperties()->SetFloatProperty(container, vr::Prop_UserIpdMeters_Float, 0.064F);
            vr::VRProperties()->SetFloatProperty(container, vr::Prop_UserHeadToEyeDepthMeters_Float, 0.0F);
            vr::VRProperties()->SetBoolProperty(container, vr::Prop_IsOnDesktop_Bool, false);
        } else {
            vr::VRProperties()->SetInt32Property(container, vr::Prop_ControllerRoleHint_Int32, role_);
            vr::VRProperties()->SetStringProperty(container, vr::Prop_ControllerType_String, "vive_controller");
            vr::VRProperties()->SetStringProperty(container, vr::Prop_InputProfilePath_String,
                "{camvr}/input/camvr_controller_profile.json");
            vr::VRDriverInput()->CreateScalarComponent(container, "/input/trigger/value",
                &triggerValue_, vr::VRScalarType_Absolute, vr::VRScalarUnits_NormalizedOneSided);
            vr::VRDriverInput()->CreateBooleanComponent(container, "/input/trigger/click", &triggerClick_);
            vr::VRDriverInput()->CreateScalarComponent(container, "/input/grip/value",
                &gripValue_, vr::VRScalarType_Absolute, vr::VRScalarUnits_NormalizedOneSided);
            vr::VRDriverInput()->CreateBooleanComponent(container, "/input/grip/click", &gripClick_);
        }

        return vr::VRInitError_None;
    }

    void Deactivate() override {
        active_ = false;
        deviceIndex_ = vr::k_unTrackedDeviceIndexInvalid;
    }

    void EnterStandby() override {}

    void* GetComponent(const char* componentNameAndVersion) override {
        if (isHmd_ && std::strcmp(componentNameAndVersion, vr::IVRDisplayComponent_Version) == 0) {
            return static_cast<vr::IVRDisplayComponent*>(this);
        }
        return nullptr;
    }

    void DebugRequest(const char*, char* responseBuffer, uint32_t responseBufferSize) override {
        if (responseBufferSize > 0) {
            responseBuffer[0] = '\0';
        }
    }

    vr::DriverPose_t GetPose() override {
        vr::DriverPose_t pose{};
        pose.qWorldFromDriverRotation.w = 1.0;
        pose.qDriverFromHeadRotation.w = 1.0;
        pose.qRotation.w = 1.0;
        pose.deviceIsConnected = true;
        pose.result = vr::TrackingResult_Uninitialized;
        return pose;
    }

    void Update(const TrackingPacket& packet, bool fresh) {
        if (!active_) {
            return;
        }

        const auto& values = packet.values;
        const bool enabled = fresh && values[0] >= 0.5F;
        const std::size_t validityIndex = isHmd_ ? 1 : (role_ == vr::TrackedControllerRole_LeftHand ? 2 : 3);
        const std::size_t dataIndex = isHmd_ ? 4 : (role_ == vr::TrackedControllerRole_LeftHand ? 11 : 20);
        const bool valid = enabled && values[validityIndex] >= 0.5F;

        vr::DriverPose_t pose{};
        pose.qWorldFromDriverRotation.w = 1.0;
        pose.qDriverFromHeadRotation.w = 1.0;
        pose.qRotation = valid ? MakeQuaternion(values, dataIndex + 3) : vr::HmdQuaternion_t{1.0, 0.0, 0.0, 0.0};
        pose.vecPosition[0] = values[dataIndex];
        pose.vecPosition[1] = values[dataIndex + 1];
        pose.vecPosition[2] = values[dataIndex + 2];
        pose.poseIsValid = valid;
        pose.deviceIsConnected = true;
        pose.result = valid ? vr::TrackingResult_Running_OK : vr::TrackingResult_Uninitialized;
        pose.shouldApplyHeadModel = isHmd_;
        vr::VRServerDriverHost()->TrackedDevicePoseUpdated(deviceIndex_, pose, sizeof(pose));

        if (!isHmd_) {
            const std::size_t triggerIndex = dataIndex + 7;
            const std::size_t gripIndex = dataIndex + 8;
            const float trigger = valid ? Clamp(values[triggerIndex]) : 0.0F;
            const float grip = valid ? Clamp(values[gripIndex]) : 0.0F;
            vr::VRDriverInput()->UpdateScalarComponent(triggerValue_, trigger, 0.0);
            vr::VRDriverInput()->UpdateBooleanComponent(triggerClick_, trigger >= 0.65F, 0.0);
            vr::VRDriverInput()->UpdateScalarComponent(gripValue_, grip, 0.0);
            vr::VRDriverInput()->UpdateBooleanComponent(gripClick_, grip >= 0.75F, 0.0);
        }
    }

    bool IsDisplayOnDesktop() override {
        return true;
    }

    bool IsDisplayRealDisplay() override {
        return false;
    }

    void GetRecommendedRenderTargetSize(uint32_t* width, uint32_t* height) override {
        *width = 2160;
        *height = 1200;
    }

    void GetEyeOutputViewport(vr::EVREye eye, uint32_t* x, uint32_t* y,
        uint32_t* width, uint32_t* height) override {
        *x = eye == vr::Eye_Left ? 0 : 1080;
        *y = 0;
        *width = 1080;
        *height = 1200;
    }

    void GetProjectionRaw(vr::EVREye, float* left, float* right, float* top, float* bottom) override {
        *left = -1.0F;
        *right = 1.0F;
        *top = -1.0F;
        *bottom = 1.0F;
    }

    vr::DistortionCoordinates_t ComputeDistortion(vr::EVREye, float u, float v) override {
        vr::DistortionCoordinates_t coordinates{};
        coordinates.rfRed[0] = coordinates.rfGreen[0] = coordinates.rfBlue[0] = u;
        coordinates.rfRed[1] = coordinates.rfGreen[1] = coordinates.rfBlue[1] = v;
        return coordinates;
    }

    void GetWindowBounds(int32_t* x, int32_t* y, uint32_t* width, uint32_t* height) override {
        *x = 0;
        *y = 0;
        *width = 2160;
        *height = 1200;
    }

    bool ComputeInverseDistortion(vr::HmdVector2_t*, vr::EVREye, uint32_t, float, float) override {
        return false;
    }

private:
    static float Clamp(float value) {
        return std::fmax(0.0F, std::fmin(1.0F, value));
    }

    static vr::HmdQuaternion_t MakeQuaternion(const std::array<float, kFieldCount>& values, std::size_t index) {
        double x = values[index];
        double y = values[index + 1];
        double z = values[index + 2];
        double w = values[index + 3];
        const double length = std::sqrt(x * x + y * y + z * z + w * w);
        if (length < 0.001 || !std::isfinite(length)) {
            return {1.0, 0.0, 0.0, 0.0};
        }
        return {w / length, x / length, y / length, z / length};
    }

    std::string serial_;
    bool isHmd_;
    vr::ETrackedControllerRole role_;
    uint32_t deviceIndex_ = vr::k_unTrackedDeviceIndexInvalid;
    bool active_ = false;
    vr::VRInputComponentHandle_t triggerValue_ = 0;
    vr::VRInputComponentHandle_t triggerClick_ = 0;
    vr::VRInputComponentHandle_t gripValue_ = 0;
    vr::VRInputComponentHandle_t gripClick_ = 0;
};

class Provider final : public vr::IServerTrackedDeviceProvider {
public:
    vr::EVRInitError Init(vr::IVRDriverContext* context) override {
        VR_INIT_SERVER_DRIVER_CONTEXT(context);
        const int startupResult = WSAStartup(MAKEWORD(2, 2), &winsock_);
        if (startupResult != 0) {
            VR_CLEANUP_SERVER_DRIVER_CONTEXT();
            return vr::VRInitError_Driver_Failed;
        }

        socket_ = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (socket_ == INVALID_SOCKET) {
            WSACleanup();
            VR_CLEANUP_SERVER_DRIVER_CONTEXT();
            return vr::VRInitError_Driver_Failed;
        }

        u_long nonBlocking = 1;
        if (ioctlsocket(socket_, FIONBIO, &nonBlocking) == SOCKET_ERROR) {
            closesocket(socket_);
            socket_ = INVALID_SOCKET;
            WSACleanup();
            VR_CLEANUP_SERVER_DRIVER_CONTEXT();
            return vr::VRInitError_Driver_Failed;
        }
        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_port = htons(kPort);
        inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);
        if (bind(socket_, reinterpret_cast<const sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR) {
            closesocket(socket_);
            socket_ = INVALID_SOCKET;
            WSACleanup();
            VR_CLEANUP_SERVER_DRIVER_CONTEXT();
            return vr::VRInitError_Driver_Failed;
        }

        hmd_ = std::make_unique<Device>("CAMVR-HMD-001", true, vr::TrackedControllerRole_Invalid);
        left_ = std::make_unique<Device>("CAMVR-LEFT-001", false, vr::TrackedControllerRole_LeftHand);
        right_ = std::make_unique<Device>("CAMVR-RIGHT-001", false, vr::TrackedControllerRole_RightHand);

        const bool hmdAdded = vr::VRServerDriverHost()->TrackedDeviceAdded(
            "CAMVR-HMD-001", vr::TrackedDeviceClass_HMD, hmd_.get());
        const bool leftAdded = vr::VRServerDriverHost()->TrackedDeviceAdded(
            "CAMVR-LEFT-001", vr::TrackedDeviceClass_Controller, left_.get());
        const bool rightAdded = vr::VRServerDriverHost()->TrackedDeviceAdded(
            "CAMVR-RIGHT-001", vr::TrackedDeviceClass_Controller, right_.get());
        if (!hmdAdded || !leftAdded || !rightAdded) {
            return vr::VRInitError_Driver_Failed;
        }
        return vr::VRInitError_None;
    }

    void Cleanup() override {
        hmd_.reset();
        left_.reset();
        right_.reset();
        if (socket_ != INVALID_SOCKET) {
            closesocket(socket_);
            socket_ = INVALID_SOCKET;
            WSACleanup();
        }
        VR_CLEANUP_SERVER_DRIVER_CONTEXT();
    }

    const char* const* GetInterfaceVersions() override {
        return vr::k_InterfaceVersions;
    }

    void RunFrame() override {
        ReceivePackets();
        bool fresh = false;
        {
            std::lock_guard<std::mutex> lock(packetMutex_);
            fresh = packet_.received &&
                std::chrono::steady_clock::now() - packet_.receivedAt < kTrackingTimeout;
            if (fresh && clientKnown_) {
                const auto now = std::chrono::steady_clock::now();
                if (now - lastReplyAt_ > std::chrono::milliseconds(300)) {
                    static constexpr char response[] = "CAMVR:READY";
                    sendto(socket_, response, static_cast<int>(sizeof(response) - 1), 0,
                        reinterpret_cast<const sockaddr*>(&clientAddress_), clientAddressLength_);
                    lastReplyAt_ = now;
                }
            }
            hmd_->Update(packet_, fresh);
            left_->Update(packet_, fresh);
            right_->Update(packet_, fresh);
        }
    }

    bool ShouldBlockStandbyMode() override {
        return false;
    }

    void EnterStandby() override {}
    void LeaveStandby() override {}

private:
    void ReceivePackets() {
        if (socket_ == INVALID_SOCKET) {
            return;
        }

        char buffer[512];
        for (;;) {
            sockaddr_in source{};
            int sourceLength = sizeof(source);
            const int bytes = recvfrom(socket_, buffer, sizeof(buffer) - 1, 0,
                reinterpret_cast<sockaddr*>(&source), &sourceLength);
            if (bytes == SOCKET_ERROR) {
                if (WSAGetLastError() == WSAEWOULDBLOCK) {
                    break;
                }
                return;
            }

            buffer[bytes] = '\0';
            TrackingPacket next{};
            int parsed = 0;
            if (std::sscanf(buffer,
                "%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f,%f%n",
                &next.values[0], &next.values[1], &next.values[2], &next.values[3],
                &next.values[4], &next.values[5], &next.values[6], &next.values[7],
                &next.values[8], &next.values[9], &next.values[10], &next.values[11],
                &next.values[12], &next.values[13], &next.values[14], &next.values[15],
                &next.values[16], &next.values[17], &next.values[18], &next.values[19],
                &next.values[20], &next.values[21], &next.values[22], &next.values[23],
                &next.values[24], &next.values[25], &next.values[26], &next.values[27],
                &next.values[28], &parsed) != static_cast<int>(kFieldCount) || buffer[parsed] != '\0') {
                continue;
            }
            bool allFinite = true;
            for (const float value : next.values) {
                allFinite = allFinite && std::isfinite(value);
            }
            if (!allFinite) {
                continue;
            }

            next.received = true;
            next.receivedAt = std::chrono::steady_clock::now();
            {
                std::lock_guard<std::mutex> lock(packetMutex_);
                packet_ = next;
                clientAddress_ = source;
                clientAddressLength_ = sourceLength;
                clientKnown_ = true;
            }
        }
    }

    WSADATA winsock_{};
    SOCKET socket_ = INVALID_SOCKET;
    std::unique_ptr<Device> hmd_;
    std::unique_ptr<Device> left_;
    std::unique_ptr<Device> right_;
    std::mutex packetMutex_;
    TrackingPacket packet_{};
    sockaddr_in clientAddress_{};
    int clientAddressLength_ = sizeof(clientAddress_);
    bool clientKnown_ = false;
    std::chrono::steady_clock::time_point lastReplyAt_{};
};

Provider provider;

}

extern "C" __declspec(dllexport) void* HmdDriverFactory(const char* interfaceName, int* returnCode) {
    if (std::strcmp(interfaceName, vr::IServerTrackedDeviceProvider_Version) == 0) {
        return &provider;
    }
    if (returnCode != nullptr) {
        *returnCode = vr::VRInitError_Init_InterfaceNotFound;
    }
    return nullptr;
}
