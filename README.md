# dvb-csr

## Description
This server application implements a Service List Registry as defined by the [DVB-I Service Discovery and Content Metadata specification - A177](https://www.dvb.org/resources/public/standards/a177_dvb-i_specification.pdf) in clause 5.1.3.2.

The application works by reading in a reference/master XML document and then pruning our any provider and service offerings that do not match the specified query parameters. Per A177, the allowed query parameters are
* regulatorListFlag
* ProviderName
* TargetCountry
* Language
* Genre

Note that these values are case sensitive, and a case sensitive matching is performed with the values, thus "AUT" != "aut"

## Installation
1. Clone this repository `git clone --recurse-submodules https://github.com/paulhiggs/dvb-csr.git`
1. Install necessary libraries (express, libxmljs, morgan)  `npm install`
1. run it - `node app`

If you want to start an HTTPS server, make sure you have `selfsigned.crt` and `selfsigned.key` files in the same directory. These can be generated (on Linux) with `sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ./selfsigned.key -out selfsigned.crt`
