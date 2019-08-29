/**
 * FritzOutletAccessory
 *
 * @url https://github.com/andig/homebridge-fritz
 * @author Andreas Götz <cpuidle@gmx.de>
 * @license MIT
 */

/* jslint node: true, laxcomma: true, esversion: 6 */
"use strict";

var inherits = require('util').inherits;
var extend = require('extend');
const fs = require('fs');
const os = require('os');
var FakeGatoHistoryService;
var moment = require('moment');


var Service, Characteristic, FritzPlatform, FritzAccessory;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    FritzPlatform = require('../platform')(homebridge);
    FritzAccessory = require('../accessory')(homebridge);

    inherits(FritzOutletAccessory, FritzAccessory);

    FakeGatoHistoryService = require('fakegato-history')(homebridge);

    return FritzOutletAccessory;
};

FritzOutletAccessory.prototype.getPowerUsage = function (callback) {
    //this.platform.log(`Getting ${this.type} ${this.ain} power usage`);

    var service = this.services.Outlet;
    callback(null, service.fritzPowerUsage);

    this.platform.fritz('getSwitchPower', this.ain).then(function(power) {
        service.fritzPowerUsage = power;
        service.getCharacteristic(FritzPlatform.PowerUsage).setValue(power, undefined, FritzPlatform.Context);
    });
};

FritzOutletAccessory.prototype.getEnergyConsumption = function (callback) {
    //this.platform.log(`Getting ${this.type} ${this.ain} energy consumption`);

    var service = this.services.Outlet;
    callback(null, service.fritzEnergyConsumption);
    
    var base = 0.0;
    if (this.baseEnergy != undefined)
    	base = this.baseEnergy;    

    this.platform.fritz('getSwitchEnergy', this.ain).then(function(energy) {
        energy = energy / 1000.0;
        var adjEnergy = energy - base;
        if (adjEnergy < 0) { 
        	// reset from FritzBox side....
        	adjEnergy = energy;
        	this.baseEnergy = energy;
	    	this.lastReset = moment().unix() - moment('2001-01-01T00:00:00Z').unix();
			this.services.fakeGatoHistoryService.setExtraPersistedData([{ "lastReset": this.lastReset, "baseEnergy": this.baseEnergy }]);
        }
        service.fritzEnergyConsumption = adjEnergy;
        service.getCharacteristic(FritzPlatform.EnergyConsumption).setValue(adjEnergy, undefined, FritzPlatform.Context);
    });
};

FritzOutletAccessory.prototype.getTemp = function (callback) {
	//this.platform.log('GetTemp', temp);

    var service = this.services.Outlet;
    callback(null, service.fritzTemperature);

    this.platform.fritz('getTemperature', this.ain).then(function(temp) {
		service.fritzTemperature = temp;
        service.getCharacteristic(FritzPlatform.Temperature).setValue(temp, undefined, FritzPlatform.Context);
	});
};

FritzOutletAccessory.prototype.getInUse = function(callback) {
    //this.platform.log(`Getting ${this.type} ${this.ain} in use`);

    var service = this.services.Outlet;
    callback(null, service.fritzInUse);

    this.platform.fritz('getSwitchPower', this.ain).then(function(power) {
        var inUse = power > 0;
        service.fritzInUse = inUse;
        service.getCharacteristic(Characteristic.OutletInUse).setValue(inUse, undefined, FritzPlatform.Context);
    });
};

function FritzOutletAccessory(platform, ain) {
		
    FritzAccessory.apply(this, Array.from(arguments).concat("outlet"));

    extend(this.services, {
        Outlet: new Service.Outlet(this.name)
    });

	this.baseEnergy = 0;

	var hostname = os.hostname().split(".")[0];
	var fileName = hostname + '_' + this.name + '_persist.json';

    extend(this.services, {
		fakeGatoHistoryService: new FakeGatoHistoryService("energy", this, { storage: 'fs', filename: fileName })
	});
	
	extend(this.services, {
		informationService: new Service.AccessoryInformation()
	});

	this.services.informationService.setCharacteristic(Characteristic.Manufacturer, "AVM");
	this.services.informationService.setCharacteristic(Characteristic.Model, "Steckdose");
	this.services.informationService.setCharacteristic(Characteristic.SerialNumber, "1.0");
	
    // Outlet
    this.services.Outlet.getCharacteristic(Characteristic.On)
        .on('get', this.getOn.bind(this))
        .on('set', this.setOn.bind(this))
    ;

	this.services.Outlet.getCharacteristic(FritzPlatform.PowerUsage)
		.on('get', this.getPowerUsage.bind(this));

	this.services.Outlet.getCharacteristic(FritzPlatform.EnergyConsumption)
		.on('get', this.getEnergyConsumption.bind(this));
		
	this.services.Outlet.getCharacteristic(FritzPlatform.ResetTotal)
		.on('get', this.getResetTotal.bind(this))
		.on('set', this.setResetTotal.bind(this));
				
    this.services.Outlet.getCharacteristic(Characteristic.OutletInUse)
        .on('getInUse', this.getInUse.bind(this))
    ;

    // TemperatureSensor - add only if device supports it
    if (this.device.temperature) {
		
		this.services.Outlet.getCharacteristic(FritzPlatform.Temperature)
			.setProps({minValue: -50})
			.on('get', this.getTemp.bind(this));
    }
    
    setInterval(this.update.bind(this), this.platform.interval);
};

FritzOutletAccessory.prototype.getResetTotal = function(callback) {

    this.extra = this.services.fakeGatoHistoryService.getExtraPersistedData();            

    if (this.extra == undefined) {
    	this.lastReset = moment().unix() - moment('2001-01-01T00:00:00Z').unix();
    	this.baseEnergy = 0;
	    // this.platform.log(this.lastReset);
    } else {
	    this.lastReset = this.services.fakeGatoHistoryService.getExtraPersistedData()[0].lastReset;
	    this.baseEnergy = this.services.fakeGatoHistoryService.getExtraPersistedData()[0].baseEnergy;
	    // this.platform.log(this.lastReset);
    }

	callback(null, this.lastReset);
};

FritzOutletAccessory.prototype.setResetTotal = function(value, callback) {

    var service = this.services.Outlet;
    
	this.baseEnergy = service.fritzEnergyConsumption;
	this.lastReset = value;
	this.services.fakeGatoHistoryService.setExtraPersistedData([{ "lastReset": this.lastReset, "baseEnergy": this.baseEnergy }]);

    this.platform.log(this.baseEnergy);

    //callback(null, service.fritzEnergyConsumption);
    //service.fritzEnergyConsumption = 0;

	callback(null, value);
};

FritzOutletAccessory.prototype.getOn = function(callback) {
    //this.platform.log(`Getting ${this.type} ${this.ain} state`);

    var service = this.services.Outlet;
    callback(null, service.fritzState);

    this.platform.fritz('getSwitchState', this.ain).then(function(state) {
        service.fritzState = state;
        service.getCharacteristic(Characteristic.On).setValue(state, undefined, FritzPlatform.Context);
    });
};

FritzOutletAccessory.prototype.setOn = function(on, callback, context) {
    if (context == FritzPlatform.Context) {
        callback(null, on);
        return;
    }

    this.platform.log(`Switching ${this.type} ${this.ain} ${this.name} to ` + (on ? 'on' : 'off'));

    var func = on ? 'setSwitchOn' : 'setSwitchOff';
    this.platform.fritz(func, this.ain).then(function(state) {
        callback(null, state);
    });
};

FritzOutletAccessory.prototype.update = function() {
    var self = this;
    var uPower, uEnergy, uTemp;

    // Outlet
    this.getOn(function(foo, state) {
        self.services.Outlet.getCharacteristic(Characteristic.On).setValue(state, undefined, FritzPlatform.Context);
    }.bind(this));

    this.getPowerUsage(function(foo, power) {
		uPower = power;
        self.services.Outlet.getCharacteristic(FritzPlatform.PowerUsage).setValue(power, undefined, FritzPlatform.Context);
    }.bind(this));

    this.getInUse(function(foo, state) {
        self.services.Outlet.getCharacteristic(Characteristic.OutletInUse).setValue(state, undefined, FritzPlatform.Context);
    }.bind(this));

    this.getEnergyConsumption(function(foo, energy) {

		uEnergy = energy;
		this.energy = energy;
        self.services.Outlet.getCharacteristic(FritzPlatform.EnergyConsumption).setValue(energy, undefined, FritzPlatform.Context);
    }.bind(this));
    
//    if (true) { //this.device.temperature) { //this.services.TemperatureSensor) {
    this.getTemp(function(foo, temp) {
		uTemp = temp;
        self.services.Outlet.getCharacteristic(FritzPlatform.Temperature).setValue(temp, undefined, FritzPlatform.Context);
    }.bind(this));

    this.platform.log(`Updated ${this.type} ${this.ain} ${this.name}: `, uPower, 'W', uEnergy, 'kWh', uTemp, '°C', this.baseEnergy, 'kWh');
    
	if (uPower !== undefined) {
		this.services.fakeGatoHistoryService.addEntry({ time: moment().unix(), power: uPower });
	};
};
