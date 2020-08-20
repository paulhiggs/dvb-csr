# dvb-csr

## Description
This server application implements a Service List Registry as defined by the [DVB-I Service Discovery and Content Metadata specification - A177](https://www.dvb.org/resources/public/standards/a177_dvb-i_specification.pdf) in clause 5.1.3.2.

The application works by reading in a reference/master XML document and then pruning our any provider and service offerings that do not match the specified query parameters. Per A177, the allowed query parameters added to the /query are
* regulatorListFlag  ("true" or "false")
* ProviderName
* TargetCountry
* Language
* Genre
These parameter names are case sensitive and the comparisons made with their values are also case sensitive against the master Service List Entry Points Registy (SLEPR)

Note that these values are case sensitive, and a case sensitive matching is performed with the values, thus "AUT" != "aut"

## Installation
1. Clone this repository `git clone --recurse-submodules https://github.com/paulhiggs/dvb-csr.git`
1. Install necessary libraries (express, libxmljs, morgan)  `npm install`

## Operation
1. Edit the Service List Entry Point Registry XML document (`slepr-master.xml`) as needed
1. run it - `node app`

The server can be reloaded with an updated `slepr-master.xml` file by invoking it with /reload, i.e. `http://localhost:3000/reload`

### Server arguments
* --port [-p] set the HTTP listening port (default: 3000)
* --sport [-s] set the HTTPS listening port (default: 3001)


If you want to start an HTTPS server, make sure you have `selfsigned.crt` and `selfsigned.key` files in the same directory. These can be generated (on Linux) with `sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ./selfsigned.key -out selfsigned.crt`
