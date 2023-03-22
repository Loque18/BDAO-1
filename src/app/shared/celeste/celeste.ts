/* eslint-disable @typescript-eslint/no-explicit-any */
import { BehaviorSubject, from, Observable, throwError } from 'rxjs';
import Web3 from 'web3';

import { Rpc, Web3Config, ProviderType } from './celeste-types';

import { WalletData } from './wallet-data';
import { Web3Wrapper } from './we3-wrapper';

import { providers } from './constants';
import { MetaMaskInpageProvider } from '@metamask/providers';
// import type EthereumProvider from '@walletconnect/ethereum-provider/dist/types/EthereumProvider';
import { environment } from 'src/environments/environment';
import { ProviderContext } from './provider-context';

import { type IProviderStrategy } from './provider-context/strategies/IProviderStrategy';
import { InjectedProviderStrategy } from './provider-context/strategies/injected';
import { LinkedProviderStrategy } from './provider-context/strategies/linked';
import { ICeleste } from '../models/iceleste';

// instantiate strategies
const StrategiesMap: {
	[key: string]: IProviderStrategy;
} = {
	[providers.INJECTED]: new InjectedProviderStrategy(),
	[providers.LINKED]: new LinkedProviderStrategy(),
};

export class Celeste implements ICeleste {
	// *~~*~~*~~ External variables ~~*~~*~~* //

	private _ready: boolean = false; // is celeste ready to be used
	private _web3Wrapper: Web3Wrapper = new Web3Wrapper(); // web3 instanecs
	private _walletData: WalletData = new WalletData(); // wallet data

	get ready(): boolean {
		return this._ready;
	}

	get walletData(): WalletData {
		return this._walletData;
	}

	// private _web3WrapperSub: BehaviorSubject<Web3Wrapper> = new BehaviorSubject<Web3Wrapper>(
	// 	this._web3Wrapper
	// );
	// public web3Wrapper$: Observable<Web3Wrapper> = this._web3WrapperSub.asObservable();

	// *~~*~~*~~ Internal variables ~~*~~*~~* //

	// create new provider context with injected strategy as default
	private _providerContext: ProviderContext = new ProviderContext(
		StrategiesMap[providers.INJECTED]
	);

	private _providerInstances: {
		injected: MetaMaskInpageProvider | undefined;
		linked: any | undefined;
	} = {
		injected: undefined,
		linked: undefined,
	};

	init(_config: Web3Config): void {
		this._initWeb3(_config).then(() => {
			this._ready = true;
		});
	}

	private async _initWeb3(config: Web3Config): Promise<void> {
		const { rpcs: rpcsObj } = config;

		const rpcs: Rpc[] = Object.values(rpcsObj);

		// 1. init strategies
		const injectedStrategy = StrategiesMap[providers.INJECTED];
		const linkedStrategy = StrategiesMap[providers.LINKED];

		// get injected provider
		try {
			await injectedStrategy.init(rpcs);
			this._providerInstances.injected =
				injectedStrategy.getProvider() as MetaMaskInpageProvider;
		} catch (e) {
			if (environment.development) console.warn('Injected provider not found');
		}

		// get linked provider
		try {
			await linkedStrategy.init(rpcs);
			this._providerInstances.linked = linkedStrategy.getProvider();
		} catch (e) {
			if (environment.development) console.warn('Linked provider not found');
		}

		// 2. try recovering existing session
		await this.getPreviousSession();

		// 3. listen for provider events
		this._listenForProviderEvents();
	}

	/**
	 * Try to recover previous session,
	 * the session restored will be the first one found
	 * in the following order: injected, linked
	 */
	private async getPreviousSession(): Promise<void> {
		// const listOfProviders = [providers.INJECTED];

		type _Session = {
			providerType: ProviderType;
			accounts: string[];
		};

		// injected
		this._providerContext.setStrategy(StrategiesMap[providers.INJECTED]);
		const injectedSession: _Session = {
			providerType: providers.INJECTED,
			accounts: await this._providerContext.getPreviosSession(),
		};

		// linked
		this._providerContext.setStrategy(StrategiesMap[providers.LINKED]);
		const linkedSession: _Session = {
			providerType: providers.LINKED,
			accounts: await this._providerContext.getPreviosSession(),
		};

		const s = [injectedSession, linkedSession].find((s) => s.accounts.length > 0);

		if (s) {
			this.storeWalletData(s.providerType, this._providerInstances[s.providerType]);
		}
	}

	// *~~*~~*~~ Wallet Methods ~~*~~*~~* //

	/**
	 *
	 * @param providerType provider type to connect to
	 * @returns an observable that emits the connection result
	 */
	public async requestConnection(providerType: ProviderType): Promise<void> {
		if (this._walletData.isLoggedIn) return;

		this._providerContext.setStrategy(StrategiesMap[providerType]);

		await this._providerContext.requestConnection();

		await this.storeWalletData(providerType, this._providerInstances[providerType]);
	}

	public async requestDisconnection(): Promise<void> {
		if (!this._walletData.isLoggedIn) return; // if user is not logged in, do nothing

		console.log('logging out');

		this._providerContext.setStrategy(StrategiesMap[this._walletData.provider as ProviderType]);

		await this._providerContext.requestDisconnection();

		this.removeWalletData();
	}

	/*
	public signMessage(message: string): Observable<unknown> {
		if (!this._walletData.isLoggedIn)
			return throwError(() => new Error('User is not logged in'));
		const type = this._walletData.provider as ProviderType;

		const provider = this._providerInstances[type];

		if (!provider) return throwError(() => new Error('Provider not found'));

		const obs = from(
			provider.request({
				method: 'personal_sign',
				params: [message, this._walletData.address],
			})
		);
		return obs;
	}
	*/

	// *~~*~~*~~ Web3 Events ~~*~~*~~* //

	private _listenForProviderEvents(): void {
		const injectedProvider: MetaMaskInpageProvider | undefined =
			this._providerInstances.injected;

		const wcProvider: any | undefined = this._providerInstances.linked;

		if (injectedProvider) {
			injectedProvider.removeAllListeners();

			injectedProvider.on('accountsChanged', (accounts) => {
				const acc: string[] = accounts as string[];

				this.accountsChanged(acc);
			});

			injectedProvider.on('chainChanged', (chainId) => {
				const chainId_decimal = parseInt(chainId as string, 16);

				this.chainChanged(chainId_decimal);
			});

			// injectedProvider.on('disconnect', () => {
			//     // this.disconnect();
			// });
		}

		if (wcProvider) {
			// eslint-disable-next-line @typescript-eslint/no-empty-function
			wcProvider.removeListener('accountsChanged', () => {});
			// eslint-disable-next-line @typescript-eslint/no-empty-function
			wcProvider.removeListener('chainChanged', () => {});
			// eslint-disable-next-line @typescript-eslint/no-empty-function
			wcProvider.removeListener('disconnect', () => {});

			wcProvider.on('accountsChanged', (acc: string[]) => {
				this.accountsChanged(acc);
			});

			wcProvider.on('chainChanged', (chainId: string) => {
				const chainIdNum: number = parseInt(chainId);
				this.chainChanged(chainIdNum);
			});

			wcProvider.on('disconnect', (stream: any) => {
				const { code, message } = stream;

				if (code === 6000) {
					this.accountsChanged([]);
				} else {
					// eslint-disable-next-line no-console
					if (environment.development)
						console.error('Wallet connect disconnected', code, message);

					this.accountsChanged([]);
				}
			});
		}
	}

	accountsChanged(accounts: string[]): void {
		if (!(accounts.length > 0)) {
			this.removeWalletData();
		} else {
			if (!this._walletData.isLoggedIn) return;

			this._walletData.setAddress(accounts[0]);
			// celesteStore.dispatch(set_address(accounts[0]));
		}
	}

	chainChanged(chainId: number): void {
		if (!this._walletData.isLoggedIn) return;

		this._walletData.setChainId(chainId);
	}

	// *~~*~~*~~ Utility Methods ~~*~~*~~* //

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async storeWalletData(providerType: ProviderType, provider: any): Promise<void> {
		const _web3: Web3 = new Web3(provider);
		const chainId: number = await _web3.eth.getChainId();
		const addresses: string[] = await _web3.eth.getAccounts();
		const address: string = addresses[0];
		const loggedIn: boolean = true;

		const walletData: WalletData = new WalletData(address, chainId, providerType, loggedIn);

		this._walletData = walletData;

		this._web3Wrapper.setWeb3Instance(_web3);
		// this._web3Subject.next(this._web3Wrapper);
	}

	private removeWalletData(): void {
		this._walletData.reset();

		this._web3Wrapper.removeWeb3Instance();
		// this._web3WrapperSub.next(this._web3Wrapper);
	}
}
