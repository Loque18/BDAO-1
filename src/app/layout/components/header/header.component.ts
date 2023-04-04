import { Component } from '@angular/core';
import { from } from 'rxjs';
import { Web3Service } from 'src/app/shared/services/web3.service';

@Component({
	selector: 'layout-header',
	templateUrl: './header.component.html',
	styleUrls: ['./header.component.scss'],
})
export class HeaderComponent {
	constructor(protected web3Svc: Web3Service) {}

	protected walletLoading: boolean = false;
	protected opened: boolean = false;

	toggle() {
		this.opened = !this.opened;
	}
}
