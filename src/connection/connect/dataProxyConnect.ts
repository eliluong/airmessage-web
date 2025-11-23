import DataProxy from "shared/connection/dataProxy";
import {normalizeServerUrl} from "shared/util/bluebubblesAuth";

import * as CloseFrame from "./webSocketCloseEventCodes";
import * as NHT from "./nht";
import ByteBuffer from "bytebuffer";
import {getInstallationID} from "shared/util/installationUtils";
import {ConnectionErrorCode} from "shared/data/stateCodes";
import {decryptData, encryptData, isCryptoPasswordAvailable} from "shared/util/encryptionUtils";
import TaskQueue from "shared/util/taskQueue";
import {getBlueBubblesAuth} from "shared/connection/connectionManager";

export function buildWebSocketURL(serverUrl: string, accessToken: string): URL {
        const url = new URL(normalizeServerUrl(serverUrl));
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        const normalizedPath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
        url.pathname = `${normalizedPath}/api/v1/socket`;
        url.searchParams.set("token", accessToken);
        url.searchParams.set("communications", String(NHT.commVer));
        url.searchParams.set("is_server", String(false));
        url.searchParams.set("installation_id", getInstallationID());
        return url;
}

export default class DataProxyConnect extends DataProxy {
	proxyType = "Connect";
	
	private readonly taskQueueEncrypt = new TaskQueue();
	private readonly taskQueueDecrypt = new TaskQueue();
	
	private socket: WebSocket | undefined;
        start(): void {
                const auth = getBlueBubblesAuth();
                if(!auth) {
                        this.notifyClose(ConnectionErrorCode.Unauthorized);
                        return;
                }

                try {
                        const url = buildWebSocketURL(auth.serverUrl, auth.accessToken);
                        this.socket = new WebSocket(url.toString());
                        this.socket.binaryType = "arraybuffer";

                        this.socket.onopen = () => {
                                this.notifyOpen();
                        };
                        this.socket.onmessage = (event: MessageEvent) => {
                                this.handleMessage(event.data);
                        };
                        this.socket.onclose = (event: CloseEvent) => {
                                this.notifyClose(DataProxyConnect.mapErrorCode(event.code));
                        };
                } catch(error) {
                        console.warn("Failed to initiate BlueBubbles socket", error);
                        this.notifyClose(ConnectionErrorCode.ExternalError);
                }
        }
	
	stop(): void {
		if(!this.socket) return;
		this.socket.close();
	}
	
	send(data: ArrayBuffer, encrypt: boolean) {
		this.taskQueueEncrypt.enqueue(async () => {
			//Check for encryption support
			const supportsEncryption = this.serverRequestsEncryption;
			if(supportsEncryption && !isCryptoPasswordAvailable()) {
				throw new Error("The server requests encryption, but no password is set");
			}
			
			//Get whether we should encrypt this packet
			const isEncrypted = encrypt && supportsEncryption;
			if(isEncrypted) {
				data = await encryptData(data);
			}
			
			const byteBuffer = ByteBuffer.allocate(1 + 4 + data.byteLength);
			byteBuffer.writeInt(NHT.nhtClientProxy);
			
			if(isEncrypted) byteBuffer.writeByte(-100); //The content is encrypted
			else if(supportsEncryption) byteBuffer.writeByte(-101); //We support encryption, but this packet should not be encrypted
			else byteBuffer.writeByte(-102); //We don't support encryption
			
			byteBuffer.append(data);
			
			if(!this.socket) return;
			this.socket.send(byteBuffer.flip().toArrayBuffer());
		});
	}
	
	sendTokenAdd(token: string) {
		const byteBuffer = new ByteBuffer()
			.writeInt(NHT.nhtClientAddFCMToken)
			.writeString(token);
		
		this.socket!.send(byteBuffer.flip().toArrayBuffer());
	}
	
	sendTokenRemove(token: string) {
		const byteBuffer = new ByteBuffer()
			.writeInt(NHT.nhtClientRemoveFCMToken)
			.writeString(token);
		
		this.socket!.send(byteBuffer.flip().toArrayBuffer());
	}
	
	private handleMessage(data: ArrayBuffer) {
		//Wrapping the data
		const byteBuffer = ByteBuffer.wrap(data);
		
		//Unpacking the message
		const type = byteBuffer.readInt();
		
		switch(type) {
                        case NHT.nhtConnectionOK: {
                                //Calling the listener
                                this.notifyOpen();

                                break;
                        }
			case NHT.nhtClientProxy: {
				/*
				 * -100 -> The content is encrypted
				 * -101 -> The content is not encrypted, but the server has encryption enabled
				 * -102 -> The server has encryption disabled
				 */
				let isSecure: boolean, isEncrypted: boolean;
				const encryptionValue = byteBuffer.readByte();
				if(encryptionValue === -100) isSecure = isEncrypted = true;
				else if(encryptionValue === -101) isSecure = isEncrypted = false;
				else if(encryptionValue === -102) {
					isSecure = true;
					isEncrypted = false;
				} else {
					throw new Error("Received unknown encryption value: " + encryptionValue);
				}
				
				//Reading the data
				let data = byteBuffer.compact().toArrayBuffer();
				
				if(isCryptoPasswordAvailable()) {
					this.taskQueueDecrypt.enqueue(async () => {
						if(isEncrypted) data = await decryptData(data);
						this.notifyMessage(data, isSecure);
					});
				} else {
					//Handling the message right away
					this.notifyMessage(data, isSecure);
				}
				
				break;
			}
		}
	}
	
        //Map a WebSocket (or AirMessage Connect) error code to a local ConnectionCode
        private static mapErrorCode(wsCode: number): ConnectionErrorCode {
                switch(wsCode) {
			case CloseFrame.NORMAL_CLOSURE:
			case CloseFrame.ABNORMAL_CLOSURE:
				return ConnectionErrorCode.Internet;
			case CloseFrame.PROTOCOL_ERROR:
			case CloseFrame.POLICY_VIOLATION:
				return ConnectionErrorCode.BadRequest;
			case NHT.closeCodeIncompatibleProtocol:
				return ConnectionErrorCode.ClientOutdated;
			case NHT.closeCodeNoGroup:
				return ConnectionErrorCode.ConnectNoGroup;
			case NHT.closeCodeNoCapacity:
				return ConnectionErrorCode.ConnectNoCapacity;
			case NHT.closeCodeAccountValidation:
				return ConnectionErrorCode.ConnectAccountValidation;
			case NHT.closeCodeNoActivation:
				return ConnectionErrorCode.ConnectNoActivation;
			case NHT.closeCodeOtherLocation:
				return ConnectionErrorCode.ConnectOtherLocation;
			default:
				return ConnectionErrorCode.ExternalError;
		}
	}
}