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
        for kind in ('desktop', 'laptop', 'printer'):
            result = validate({**self.device, 'kind': kind})
            for key in ('mac_address', 'processor', 'ram'):
                self.assertEqual(result[key], '')

    def test_mac_formats_and_specs(self):
        for mac in ('aa:bb:cc:dd:ee:ff', 'aa-bb-cc-dd-ee-ff', 'aabb.ccdd.eeff', 'aabbccddeeff'):
            result = validate({**self.device, 'mac_address': mac, 'processor': 'Intel Core i5', 'ram': '16 GB DDR4'})
            self.assertEqual(result['mac_address'], 'AA:BB:CC:DD:EE:FF')
            self.assertEqual(result['processor'], 'Intel Core i5')
            self.assertEqual(result['ram'], '16 GB DDR4')

    def test_invalid_values(self):
        for change in ({'kind': 'scanner'}, {'mac_address': 'invalid'}, {'ram': 16}, {'processor': 'x' * 201}):
            with self.assertRaises(ValueError):
                validate({**self.device, **change})


if __name__ == '__main__':
    unittest.main()
