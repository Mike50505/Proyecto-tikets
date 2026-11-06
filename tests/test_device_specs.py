"""Inventory validation checks; no database or running service required."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'api'))
from inventory import validate


class DeviceSpecsTests(unittest.TestCase):
    def setUp(self):
        self.device = dict(name='Equipo', kind='desktop', area='Sistemas', owner='Persona')

    def test_optional_fields_and_printers(self):
        for kind in ('desktop', 'laptop', 'printer', 'tablet', 'phone'):
            result = validate({**self.device, 'kind': kind})
            for key in ('mac_address', 'ip_address', 'processor', 'ram'):
                self.assertEqual(result[key], '')

    def test_ip_for_all_devices(self):
        for kind in ('desktop', 'laptop', 'printer', 'tablet', 'phone'):
            for address in ('192.168.1.25', '2001:db8::1'):
                self.assertEqual(validate({**self.device, 'kind': kind, 'ip_address': address})['ip_address'], address)
        for address in ('192.168.1.999', 'equipo.local', '192.168.1.25/24', 'fe80::1%eth0'):
            with self.assertRaises(ValueError):
                validate({**self.device, 'ip_address': address})

    def test_mac_formats_and_specs(self):
        for mac in ('aa:bb:cc:dd:ee:ff', 'aa-bb-cc-dd-ee-ff', 'aabb.ccdd.eeff', 'aabbccddeeff'):
            result = validate({**self.device, 'mac_address': mac, 'processor': 'Intel Core i5', 'ram': '16 GB DDR4'})
            self.assertEqual(result['mac_address'], 'AA:BB:CC:DD:EE:FF')
            self.assertEqual(result['processor'], 'Intel Core i5')
            self.assertEqual(result['ram'], '16 GB DDR4')

    def test_phones_cannot_have_map_coordinates(self):
        result = validate({**self.device, 'kind': 'phone', 'x': 25, 'y': 40})
        self.assertIsNone(result['x'])
        self.assertIsNone(result['y'])
        tablet = validate({**self.device, 'kind': 'tablet', 'x': 25, 'y': 40})
        self.assertEqual((tablet['x'], tablet['y']), (25, 40))

    def test_optional_floor_and_office(self):
        self.assertEqual(validate(self.device)['floor'], '')
        self.assertEqual(validate(self.device)['office'], '')
        for floor in ('ground', 'upper'):
            result = validate({**self.device, 'floor': floor, 'office': ' Contabilidad '})
            self.assertEqual(result['floor'], floor)
            self.assertEqual(result['office'], 'Contabilidad')
        for change in ({'floor': 'invalid'}, {'floor': 1}, {'office': 'x' * 201}):
            with self.assertRaises(ValueError):
                validate({**self.device, **change})

    def test_invalid_values(self):
        for change in ({'kind': 'scanner'}, {'mac_address': 'invalid'}, {'ram': 16}, {'processor': 'x' * 201}):
            with self.assertRaises(ValueError):
                validate({**self.device, **change})


if __name__ == '__main__':
    unittest.main()
