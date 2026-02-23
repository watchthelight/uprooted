/** Opaque branded types for Root's GUID system. */
export type UserGuid = string & { readonly __brand: "UserGuid" };
export type DeviceGuid = string & { readonly __brand: "DeviceGuid" };

export type TileType = "camera" | "screen" | "audio";

export interface Coordinates {
  x: number;
  y: number;
}

export interface IUserResponse {
  userId: UserGuid;
  displayName: string;
  avatarUrl?: string;
  [key: string]: unknown;
}

export type WebRtcPermission = Record<string, boolean>;

export type Theme = "dark" | "light" | "pure-dark";
export type ScreenQualityMode = "motion" | "detail" | "auto";
export type Codec = string;

export interface UserMediaStreamConstraints {
  audio?: MediaTrackConstraints | boolean;
  video?: MediaTrackConstraints | boolean;
}

export interface DisplayMediaStreamConstraints {
  audio?: MediaTrackConstraints | boolean;
  video?: MediaTrackConstraints | boolean;
}

export interface VolumeBoosterSettings {
  enabled: boolean;
  gain: number;
}

export interface WebRtcError {
  code: string;
  message: string;
}

export interface InitializeDesktopWebRtcPayload {
  token: string;
  channelId: string;
  communityId: string;
  userId: UserGuid;
  deviceId: DeviceGuid;
  theme: Theme;
  [key: string]: unknown;
}

export interface IPacket {
  type: string;
  data: unknown;
}

/**
 * Methods called by the WebRTC layer → native (.NET) side.
 * JS code calls these to notify the native host of state changes.
 */
export interface IWebRtcToNative {
  initialized(): void;
  remoteLiveMediaTrackStarted(): void;
  remoteAudioTrackStarted(userIds: UserGuid[]): void;
  remoteLiveMediaTrackStopped(): void;
  disconnected(): void;
  localMuteWasSet(isMuted: boolean): void;
  localDeafenWasSet(isDeafened: boolean): void;
  localAudioFailed(): void;
  localAudioStarted(): void;
  localVideoFailed(): void;
  localVideoStarted(): void;
  localScreenFailed(): void;
  localScreenStarted(): void;
  localScreenAudioFailed(): void;
  localAudioStopped(): void;
  localVideoStopped(): void;
  localScreenStopped(): void;
  localScreenAudioStopped(): void;
  getUserProfile(userId: UserGuid): Promise<IUserResponse>;
  getUserProfiles(userIds: UserGuid[]): Promise<IUserResponse[]>;
  setSpeaking(isSpeaking: boolean, deviceId: DeviceGuid, userId: UserGuid): void;
  setHandRaised(isHandRaised: boolean, deviceId: DeviceGuid, userId: UserGuid): void;
  failed(error: WebRtcError): void;
  setAdminMute(deviceId: DeviceGuid, isMuted: boolean): void;
  setAdminDeafen(deviceId: DeviceGuid, isDeafened: boolean): void;
  kickPeer(userId: UserGuid): void;
  viewProfileMenu(userId: UserGuid, coordinates: Coordinates): void;
  viewContextMenu(
    userId: UserGuid,
    coordinates: Coordinates,
    tileType?: TileType,
    volume?: number,
  ): void;
  log(message: string): void;
}

/**
 * Methods called by the native (.NET) side → WebRTC layer.
 * The C# host calls these to control the WebRTC session.
 */
export interface INativeToWebRtc {
  initialize(state: InitializeDesktopWebRtcPayload): void;
  disconnect(): void;
  setIsVideoOn(isVideo: boolean): void;
  setIsScreenShareOn(isScreenShare: boolean, withAudio?: boolean): void;
  setIsAudioOn(isAudio: boolean): void;
  updateVideoDeviceId(videoSourceId: string): void;
  updateAudioInputDeviceId(micSourceId: string): void;
  updateAudioOutputDeviceId(soundSourceId: string): void;
  updateScreenShareDeviceId(screenSourceId: string): void;
  updateScreenAudioDeviceId(screenAudioSourceId: string): void;
  updateProfile(user: IUserResponse): void;
  updateMyPermission(myUserPermission: WebRtcPermission): void;
  setPushToTalkMode(isPushToTalkMode: boolean): void;
  setPushToTalk(isPushingToTalk: boolean): void;
  setMute(isMuted: boolean): void;
  setDeafen(isDeafened: boolean): void;
  setHandRaised(isHandRaised: boolean): void;
  setTheme(theme: Theme): void;
  setNoiseGateThreshold(threshold: number): void;
  setDenoisePower(power: number): void;
  setScreenQualityMode(qualityMode: ScreenQualityMode): void;
  toggleFullFocus(isFullFocus: boolean): void;
  setPreferredCodecs(preferredCodecs: Codec[]): void;
  setUserMediaConstraints(constraints: UserMediaStreamConstraints): void;
  setDisplayMediaConstraints(constraints: DisplayMediaStreamConstraints): void;
  setScreenContentHint(contentHint: string): void;
  setAdminMute(userId: UserGuid, isAdminMuted: boolean): void;
  setAdminDeafen(userId: UserGuid, isAdminDeafened: boolean): void;
  screenPickerDismissed(): void;
  setTileVolume(userId: UserGuid, tileType: TileType, volume: number): void;
  setOutputVolume(volume: number): void;
  setInputVolume(volume: number): void;
  customizeVolumeBooster(settings: VolumeBoosterSettings): void;
  kick(userId: UserGuid): void;
  receiveRawPacket(data: unknown): void;
  receiveRawPacketContainer(data: unknown): void;
  receivePacket(packet: IPacket): void;
  nativeLoopbackAudioStarted(sampleRate: number, channels: number): Promise<void>;
  receiveNativeLoopbackAudioData(bridgeData: unknown, byteCount: number): void;
  getNativeLoopbackAudioTrack(): MediaStreamTrack | null;
  stopNativeLoopbackAudio(): void;
}
